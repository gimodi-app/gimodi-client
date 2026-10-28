//! EGL display on a DRM render node (through GBM) with a surfaceless GLES 3
//! context, plus DMA-BUF import.

use std::ffi::c_void;
use std::fs::{File, OpenOptions};
use std::os::fd::AsRawFd;
use std::ptr;

use khronos_egl as egl;
use libloading::Library;

use super::DmaBufFrame;

/// Modifier value meaning "implicit modifier" (the driver decides the layout).
pub const DRM_FORMAT_MOD_INVALID: u64 = 0x00ff_ffff_ffff_ffff;

const PLATFORM_GBM_KHR: egl::Enum = 0x31D7;
const LINUX_DMA_BUF_EXT: egl::Enum = 0x3270;
const LINUX_DRM_FOURCC_EXT: egl::Attrib = 0x3271;
const PLANE_ATTRIBUTES: [[egl::Attrib; 5]; 4] = [
    [0x3272, 0x3273, 0x3274, 0x3443, 0x3444],
    [0x3275, 0x3276, 0x3277, 0x3445, 0x3446],
    [0x3278, 0x3279, 0x327A, 0x3447, 0x3448],
    [0x3440, 0x3441, 0x3442, 0x3449, 0x344A],
];
const REQUIRED_EXTENSIONS: [&str; 3] = [
    "EGL_EXT_image_dma_buf_import",
    "EGL_EXT_image_dma_buf_import_modifiers",
    "EGL_KHR_surfaceless_context",
];
const FIRST_RENDER_NODE: u32 = 128;
const LAST_RENDER_NODE: u32 = 191;

type QueryDmaBufFormats = unsafe extern "system" fn(*mut c_void, egl::Int, *mut egl::Int, *mut egl::Int) -> egl::Boolean;
type QueryDmaBufModifiers =
    unsafe extern "system" fn(*mut c_void, egl::Int, egl::Int, *mut u64, *mut egl::Boolean, *mut egl::Int) -> egl::Boolean;
type ImageTargetTexture2D = unsafe extern "system" fn(u32, *mut c_void);
type GbmCreateDevice = unsafe extern "C" fn(i32) -> *mut c_void;
type GbmDeviceDestroy = unsafe extern "C" fn(*mut c_void);

/// `libgbm.so.1`, loaded at runtime so the module works without it.
pub struct Gbm {
    /// Keeps libgbm loaded while its entry points are in use.
    pub _library: Library,
    create_device: GbmCreateDevice,
    device_destroy: GbmDeviceDestroy,
}

impl Gbm {
    /// Loads `libgbm.so.1` and the device entry points.
    fn load() -> Result<Self, String> {
        unsafe {
            let library = Library::new("libgbm.so.1").map_err(|e| format!("libgbm: {e}"))?;
            let create_device = *library
                .get::<GbmCreateDevice>(b"gbm_create_device\0")
                .map_err(|e| format!("gbm_create_device: {e}"))?;
            let device_destroy = *library
                .get::<GbmDeviceDestroy>(b"gbm_device_destroy\0")
                .map_err(|e| format!("gbm_device_destroy: {e}"))?;
            Ok(Self { _library: library, create_device, device_destroy })
        }
    }
}

/// An initialised EGL display with a current GLES 3 context.
pub struct Egl {
    pub instance: egl::DynamicInstance<egl::EGL1_5>,
    pub gbm: Gbm,
    pub device: *mut c_void,
    display: egl::Display,
    context: egl::Context,
    query_formats: QueryDmaBufFormats,
    query_modifiers: QueryDmaBufModifiers,
    image_target_texture: ImageTargetTexture2D,
    node: File,
}

impl Egl {
    /// Opens the first usable render node and makes a GLES 3 context current.
    pub fn new() -> Result<Self, String> {
        let instance = unsafe { egl::DynamicInstance::<egl::EGL1_5>::load_required_from_filename("libEGL.so.1") }
            .map_err(|e| format!("libEGL: {e}"))?;
        let gbm = Gbm::load()?;
        let (query_formats, query_modifiers, image_target_texture) = Self::load_extensions(&instance)?;
        let mut last_error = String::from("no DRM render node found");
        for index in FIRST_RENDER_NODE..=LAST_RENDER_NODE {
            let path = format!("/dev/dri/renderD{index}");
            let Ok(node) = OpenOptions::new().read(true).write(true).open(&path) else {
                continue;
            };
            match Self::open_display(&instance, &gbm, &node) {
                Ok((device, display, context)) => {
                    return Ok(Self {
                        instance,
                        gbm,
                        device,
                        display,
                        context,
                        query_formats,
                        query_modifiers,
                        image_target_texture,
                        node,
                    })
                }
                Err(error) => last_error = format!("{path}: {error}"),
            }
        }
        Err(last_error)
    }

    /// Creates a GBM device, EGL display and current context on one render node.
    fn open_display(
        instance: &egl::DynamicInstance<egl::EGL1_5>,
        gbm: &Gbm,
        node: &File,
    ) -> Result<(*mut c_void, egl::Display, egl::Context), String> {
        let device = unsafe { (gbm.create_device)(node.as_raw_fd()) };
        if device.is_null() {
            return Err("gbm_create_device failed".into());
        }
        match Self::create_context(instance, device) {
            Ok((display, context)) => Ok((device, display, context)),
            Err(error) => {
                unsafe { (gbm.device_destroy)(device) };
                Err(error)
            }
        }
    }

    /// Creates the display, checks extensions and makes a context current.
    fn create_context(
        instance: &egl::DynamicInstance<egl::EGL1_5>,
        device: *mut c_void,
    ) -> Result<(egl::Display, egl::Context), String> {
        let display = unsafe { instance.get_platform_display(PLATFORM_GBM_KHR, device, &[egl::ATTRIB_NONE]) }
            .map_err(|e| format!("eglGetPlatformDisplay: {e}"))?;
        instance.initialize(display).map_err(|e| format!("eglInitialize: {e}"))?;
        let extensions = instance
            .query_string(Some(display), egl::EXTENSIONS)
            .map_err(|e| format!("eglQueryString: {e}"))?
            .to_string_lossy()
            .into_owned();
        if let Some(missing) = REQUIRED_EXTENSIONS.iter().find(|name| !extensions.split(' ').any(|e| e == **name)) {
            let _ = instance.terminate(display);
            return Err(format!("missing {missing}"));
        }
        instance.bind_api(egl::OPENGL_ES_API).map_err(|e| format!("eglBindAPI: {e}"))?;
        let config = if extensions.split(' ').any(|e| e == "EGL_KHR_no_config_context") {
            unsafe { egl::Config::from_ptr(ptr::null_mut()) }
        } else {
            instance
                .choose_first_config(display, &[egl::RENDERABLE_TYPE, egl::OPENGL_ES3_BIT, egl::NONE])
                .map_err(|e| format!("eglChooseConfig: {e}"))?
                .ok_or("no GLES 3 config")?
        };
        let context = instance
            .create_context(display, config, None, &[egl::CONTEXT_MAJOR_VERSION, 3, egl::CONTEXT_MINOR_VERSION, 0, egl::NONE])
            .map_err(|e| format!("eglCreateContext: {e}"))?;
        instance
            .make_current(display, None, None, Some(context))
            .map_err(|e| format!("eglMakeCurrent: {e}"))?;
        Ok((display, context))
    }

    /// Resolves the extension entry points used for DMA-BUF handling.
    fn load_extensions(
        instance: &egl::DynamicInstance<egl::EGL1_5>,
    ) -> Result<(QueryDmaBufFormats, QueryDmaBufModifiers, ImageTargetTexture2D), String> {
        let lookup = |name: &str| instance.get_proc_address(name).ok_or_else(|| format!("missing {name}"));
        unsafe {
            Ok((
                std::mem::transmute::<extern "system" fn(), QueryDmaBufFormats>(lookup("eglQueryDmaBufFormatsEXT")?),
                std::mem::transmute::<extern "system" fn(), QueryDmaBufModifiers>(lookup("eglQueryDmaBufModifiersEXT")?),
                std::mem::transmute::<extern "system" fn(), ImageTargetTexture2D>(lookup("glEGLImageTargetTexture2DOES")?),
            ))
        }
    }

    /// The DRM render node the display runs on.
    pub fn node(&self) -> &File {
        &self.node
    }

    /// Resolves a GL entry point for glow.
    pub fn proc_address(&self, name: &str) -> *const c_void {
        self.instance
            .get_proc_address(name)
            .map_or(ptr::null(), |f| f as *const c_void)
    }

    /// DRM modifiers the driver can import for a fourcc; `[INVALID]` when the
    /// format is supported without explicit modifiers, empty when unsupported.
    pub fn modifiers(&self, fourcc: u32) -> Vec<u64> {
        let display = self.display.as_ptr();
        let mut count: egl::Int = 0;
        unsafe {
            if (self.query_formats)(display, 0, ptr::null_mut(), &mut count) == egl::FALSE {
                return Vec::new();
            }
            let mut formats = vec![0; count as usize];
            if (self.query_formats)(display, count, formats.as_mut_ptr(), &mut count) == egl::FALSE
                || !formats.iter().any(|&f| f as u32 == fourcc)
            {
                return Vec::new();
            }
            let mut modifiers_count: egl::Int = 0;
            (self.query_modifiers)(display, fourcc as egl::Int, 0, ptr::null_mut(), ptr::null_mut(), &mut modifiers_count);
            if modifiers_count == 0 {
                return vec![DRM_FORMAT_MOD_INVALID];
            }
            let mut modifiers = vec![0u64; modifiers_count as usize];
            let mut external = vec![egl::FALSE; modifiers_count as usize];
            (self.query_modifiers)(
                display,
                fourcc as egl::Int,
                modifiers_count,
                modifiers.as_mut_ptr(),
                external.as_mut_ptr(),
                &mut modifiers_count,
            );
            modifiers.truncate(modifiers_count as usize);
            modifiers
        }
    }

    /// Imports a DMA-BUF frame as an EGL image.
    pub fn create_image(&self, frame: &DmaBufFrame) -> Result<egl::Image, String> {
        if frame.planes.is_empty() || frame.planes.len() > PLANE_ATTRIBUTES.len() {
            return Err(format!("unsupported plane count {}", frame.planes.len()));
        }
        let mut attributes: Vec<egl::Attrib> = vec![
            egl::WIDTH as egl::Attrib,
            frame.width as egl::Attrib,
            egl::HEIGHT as egl::Attrib,
            frame.height as egl::Attrib,
            LINUX_DRM_FOURCC_EXT,
            frame.format.drm_fourcc() as egl::Attrib,
        ];
        for (plane, names) in frame.planes.iter().zip(PLANE_ATTRIBUTES) {
            attributes.extend([names[0], plane.fd as egl::Attrib, names[1], plane.offset as egl::Attrib, names[2], plane.stride as egl::Attrib]);
            if frame.modifier != DRM_FORMAT_MOD_INVALID {
                attributes.extend([names[3], (frame.modifier & 0xffff_ffff) as egl::Attrib, names[4], (frame.modifier >> 32) as egl::Attrib]);
            }
        }
        attributes.push(egl::ATTRIB_NONE);
        unsafe {
            self.instance.create_image(
                self.display,
                egl::Context::from_ptr(egl::NO_CONTEXT),
                LINUX_DMA_BUF_EXT,
                egl::ClientBuffer::from_ptr(ptr::null_mut()),
                &attributes,
            )
        }
        .map_err(|e| format!("eglCreateImage: {e}"))
    }

    /// Binds an EGL image to the currently bound texture of `target`.
    pub fn bind_image(&self, target: u32, image: &egl::Image) {
        unsafe { (self.image_target_texture)(target, image.as_ptr()) };
    }

    /// Destroys an EGL image created by [`Egl::create_image`].
    pub fn destroy_image(&self, image: egl::Image) {
        let _ = self.instance.destroy_image(self.display, image);
    }
}

impl Drop for Egl {
    fn drop(&mut self) {
        let _ = self.instance.make_current(self.display, None, None, None);
        let _ = self.instance.destroy_context(self.display, self.context);
        let _ = self.instance.terminate(self.display);
        unsafe { (self.gbm.device_destroy)(self.device) };
    }
}
