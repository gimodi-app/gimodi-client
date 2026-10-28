//! GPU conversion of DMA-BUF frames to I420 through EGL and GLES 3.

mod egl;
mod shaders;
mod syncobj;
#[cfg(test)]
mod test_buffer;

use std::os::fd::RawFd;

use glow::HasContext;

use crate::formats::PixelFormat;
use crate::geometry::Rect;
use egl::Egl;
pub use egl::DRM_FORMAT_MOD_INVALID;
pub use syncobj::Timelines;

const TEXTURE_EXTERNAL_OES: u32 = 0x8D65;

/// One plane of a DMA-BUF.
#[derive(Clone, Copy, Debug)]
pub struct DmaBufPlane {
    pub fd: RawFd,
    pub offset: u32,
    pub stride: u32,
}

/// A DMA-BUF frame as delivered by PipeWire.
pub struct DmaBufFrame<'a> {
    pub width: u32,
    pub height: u32,
    pub format: PixelFormat,
    pub modifier: u64,
    pub planes: &'a [DmaBufPlane],
    pub crop: Rect,
}

/// Which texture the render passes sample.
#[derive(Clone, Copy)]
enum Source {
    External,
    Plain,
}

/// A linked conversion program and its uniform locations.
struct Program {
    program: glow::Program,
    texture: Option<glow::UniformLocation>,
    src_origin: Option<glow::UniformLocation>,
    src_size: Option<glow::UniformLocation>,
    out_size: Option<glow::UniformLocation>,
    plane: Option<glow::UniformLocation>,
}

/// Render target of one I420 plane, packed four samples per RGBA texel.
struct PlaneTarget {
    texture: glow::Texture,
    framebuffer: glow::Framebuffer,
    width: i32,
    height: i32,
    offset: usize,
    len: usize,
}

/// Render targets for one output size.
struct Targets {
    width: u32,
    height: u32,
    planes: Vec<PlaneTarget>,
}

/// Converts frames to I420 on the GPU. Bound to the thread that created it.
pub struct GpuConverter {
    gl: glow::Context,
    external: Program,
    plain: Program,
    external_texture: glow::Texture,
    plain_texture: glow::Texture,
    targets: Option<Targets>,
    timelines: Option<Timelines>,
    egl: Egl,
}

impl GpuConverter {
    /// Sets up EGL, the GLES 3 context and the conversion programs.
    pub fn new() -> Result<Self, String> {
        let egl = Egl::new()?;
        let gl = unsafe { glow::Context::from_loader_function(|name| egl.proc_address(name)) };
        if !gl.supported_extensions().contains("GL_OES_EGL_image_external_essl3") {
            return Err("missing GL_OES_EGL_image_external_essl3".into());
        }
        let external = compile_program(&gl, &shaders::fragment_external())?;
        let plain = compile_program(&gl, &shaders::fragment_2d())?;
        let external_texture = create_source_texture(&gl, TEXTURE_EXTERNAL_OES)?;
        let plain_texture = create_source_texture(&gl, glow::TEXTURE_2D)?;
        let timelines = Timelines::new(egl.node())
            .inspect_err(|error| eprintln!("[screencast] explicit sync unavailable: {error}"))
            .ok();
        Ok(Self { gl, external, plain, external_texture, plain_texture, targets: None, timelines, egl })
    }

    /// DRM modifiers this GPU can import for `format`.
    pub fn modifiers(&self, format: PixelFormat) -> Vec<u64> {
        self.egl.modifiers(format.drm_fourcc())
    }

    /// Syncobj access for explicit sync, when the DRM device supports it.
    pub fn timelines(&self) -> Option<&Timelines> {
        self.timelines.as_ref()
    }

    /// Converts the crop region of a DMA-BUF frame to I420 of the given size.
    pub fn convert_dmabuf(&mut self, frame: &DmaBufFrame, out_width: u32, out_height: u32, out: &mut Vec<u8>) -> Result<(), String> {
        check_output_size(out_width, out_height)?;
        let image = self.egl.create_image(frame)?;
        unsafe { self.gl.bind_texture(TEXTURE_EXTERNAL_OES, Some(self.external_texture)) };
        self.egl.bind_image(TEXTURE_EXTERNAL_OES, &image);
        let result = self
            .gl_error("glEGLImageTargetTexture2DOES")
            .and_then(|()| self.render(Source::External, frame.width, frame.height, frame.crop, out_width, out_height, out));
        self.egl.destroy_image(image);
        result
    }

    /// Converts the crop region of a tightly packed RGBA image to I420.
    #[allow(clippy::too_many_arguments)]
    pub fn convert_rgba(
        &mut self,
        rgba: &[u8],
        width: u32,
        height: u32,
        crop: Rect,
        out_width: u32,
        out_height: u32,
        out: &mut Vec<u8>,
    ) -> Result<(), String> {
        check_output_size(out_width, out_height)?;
        unsafe {
            self.gl.bind_texture(glow::TEXTURE_2D, Some(self.plain_texture));
            self.gl.tex_image_2d(
                glow::TEXTURE_2D,
                0,
                glow::RGBA8 as i32,
                width as i32,
                height as i32,
                0,
                glow::RGBA,
                glow::UNSIGNED_BYTE,
                glow::PixelUnpackData::Slice(Some(rgba)),
            );
        }
        self.gl_error("glTexImage2D")?;
        self.render(Source::Plain, width, height, crop, out_width, out_height, out)
    }

    /// Creates a GBM buffer filled with `pixels` for DMA-BUF import tests.
    #[cfg(test)]
    pub fn test_dmabuf(&self, format: PixelFormat, width: u32, height: u32, pixels: &[u8]) -> Result<test_buffer::TestDmaBuf, String> {
        test_buffer::TestDmaBuf::new(&self.egl, format.drm_fourcc(), width, height, pixels)
    }

    /// Runs the Y, U and V passes and reads them back into `out`.
    #[allow(clippy::too_many_arguments)]
    fn render(
        &mut self,
        source: Source,
        src_width: u32,
        src_height: u32,
        crop: Rect,
        out_width: u32,
        out_height: u32,
        out: &mut Vec<u8>,
    ) -> Result<(), String> {
        self.ensure_targets(out_width, out_height)?;
        let luma = out_width as usize * out_height as usize;
        out.resize(luma + luma / 2, 0);
        let (program, target, texture) = match source {
            Source::External => (&self.external, TEXTURE_EXTERNAL_OES, self.external_texture),
            Source::Plain => (&self.plain, glow::TEXTURE_2D, self.plain_texture),
        };
        let gl = &self.gl;
        let targets = self.targets.as_ref().ok_or("render targets missing")?;
        unsafe {
            gl.use_program(Some(program.program));
            gl.active_texture(glow::TEXTURE0);
            gl.bind_texture(target, Some(texture));
            gl.uniform_1_i32(program.texture.as_ref(), 0);
            gl.uniform_2_f32(program.src_origin.as_ref(), crop.x as f32 / src_width as f32, crop.y as f32 / src_height as f32);
            gl.uniform_2_f32(program.src_size.as_ref(), crop.width as f32 / src_width as f32, crop.height as f32 / src_height as f32);
            gl.uniform_2_f32(program.out_size.as_ref(), out_width as f32, out_height as f32);
            for (index, plane) in targets.planes.iter().enumerate() {
                gl.bind_framebuffer(glow::FRAMEBUFFER, Some(plane.framebuffer));
                gl.viewport(0, 0, plane.width, plane.height);
                gl.uniform_1_i32(program.plane.as_ref(), index as i32);
                gl.draw_arrays(glow::TRIANGLES, 0, 3);
                gl.read_pixels(
                    0,
                    0,
                    plane.width,
                    plane.height,
                    glow::RGBA,
                    glow::UNSIGNED_BYTE,
                    glow::PixelPackData::Slice(Some(&mut out[plane.offset..plane.offset + plane.len])),
                );
            }
            gl.bind_framebuffer(glow::FRAMEBUFFER, None);
        }
        self.gl_error("render passes")
    }

    /// Creates the per-plane render targets for an output size if needed.
    fn ensure_targets(&mut self, width: u32, height: u32) -> Result<(), String> {
        if self.targets.as_ref().is_some_and(|t| t.width == width && t.height == height) {
            return Ok(());
        }
        if let Some(old) = self.targets.take() {
            delete_targets(&self.gl, old);
        }
        let luma = width as usize * height as usize;
        let layout = [
            (width / 4, height, 0, luma),
            (width / 8, height / 2, luma, luma / 4),
            (width / 8, height / 2, luma + luma / 4, luma / 4),
        ];
        let mut planes = Vec::with_capacity(layout.len());
        for (plane_width, plane_height, offset, len) in layout {
            match create_plane_target(&self.gl, plane_width as i32, plane_height as i32, offset, len) {
                Ok(plane) => planes.push(plane),
                Err(error) => {
                    delete_targets(&self.gl, Targets { width, height, planes });
                    return Err(error);
                }
            }
        }
        self.targets = Some(Targets { width, height, planes });
        Ok(())
    }

    /// Returns an error if the GL error flag is set.
    fn gl_error(&self, context: &str) -> Result<(), String> {
        match unsafe { self.gl.get_error() } {
            glow::NO_ERROR => Ok(()),
            code => Err(format!("{context}: GL error 0x{code:x}")),
        }
    }
}

impl Drop for GpuConverter {
    fn drop(&mut self) {
        if let Some(targets) = self.targets.take() {
            delete_targets(&self.gl, targets);
        }
        unsafe {
            self.gl.delete_program(self.external.program);
            self.gl.delete_program(self.plain.program);
            self.gl.delete_texture(self.external_texture);
            self.gl.delete_texture(self.plain_texture);
        }
    }
}

/// Validates an I420 output size for the packed readback.
fn check_output_size(width: u32, height: u32) -> Result<(), String> {
    if width == 0 || height == 0 || width % 8 != 0 || height % 2 != 0 {
        return Err(format!("invalid output size {width}x{height}"));
    }
    Ok(())
}

/// Compiles the shared vertex shader with a fragment shader into a program.
fn compile_program(gl: &glow::Context, fragment: &str) -> Result<Program, String> {
    unsafe {
        let program = gl.create_program()?;
        let mut shaders = Vec::new();
        for (kind, source) in [(glow::VERTEX_SHADER, shaders::VERTEX), (glow::FRAGMENT_SHADER, fragment)] {
            let shader = gl.create_shader(kind)?;
            gl.shader_source(shader, source);
            gl.compile_shader(shader);
            if !gl.get_shader_compile_status(shader) {
                let log = gl.get_shader_info_log(shader);
                gl.delete_shader(shader);
                gl.delete_program(program);
                return Err(format!("shader compile failed: {log}"));
            }
            gl.attach_shader(program, shader);
            shaders.push(shader);
        }
        gl.link_program(program);
        for shader in shaders {
            gl.detach_shader(program, shader);
            gl.delete_shader(shader);
        }
        if !gl.get_program_link_status(program) {
            let log = gl.get_program_info_log(program);
            gl.delete_program(program);
            return Err(format!("program link failed: {log}"));
        }
        Ok(Program {
            program,
            texture: gl.get_uniform_location(program, "u_texture"),
            src_origin: gl.get_uniform_location(program, "u_src_origin"),
            src_size: gl.get_uniform_location(program, "u_src_size"),
            out_size: gl.get_uniform_location(program, "u_out_size"),
            plane: gl.get_uniform_location(program, "u_plane"),
        })
    }
}

/// Creates a linearly filtered, edge-clamped texture for the given target.
fn create_source_texture(gl: &glow::Context, target: u32) -> Result<glow::Texture, String> {
    unsafe {
        let texture = gl.create_texture()?;
        gl.bind_texture(target, Some(texture));
        gl.tex_parameter_i32(target, glow::TEXTURE_MIN_FILTER, glow::LINEAR as i32);
        gl.tex_parameter_i32(target, glow::TEXTURE_MAG_FILTER, glow::LINEAR as i32);
        gl.tex_parameter_i32(target, glow::TEXTURE_WRAP_S, glow::CLAMP_TO_EDGE as i32);
        gl.tex_parameter_i32(target, glow::TEXTURE_WRAP_T, glow::CLAMP_TO_EDGE as i32);
        Ok(texture)
    }
}

/// Creates an RGBA8 texture with a framebuffer for one plane.
fn create_plane_target(gl: &glow::Context, width: i32, height: i32, offset: usize, len: usize) -> Result<PlaneTarget, String> {
    unsafe {
        let texture = gl.create_texture()?;
        gl.bind_texture(glow::TEXTURE_2D, Some(texture));
        gl.tex_storage_2d(glow::TEXTURE_2D, 1, glow::RGBA8, width, height);
        let framebuffer = gl.create_framebuffer()?;
        gl.bind_framebuffer(glow::FRAMEBUFFER, Some(framebuffer));
        gl.framebuffer_texture_2d(glow::FRAMEBUFFER, glow::COLOR_ATTACHMENT0, glow::TEXTURE_2D, Some(texture), 0);
        let status = gl.check_framebuffer_status(glow::FRAMEBUFFER);
        gl.bind_framebuffer(glow::FRAMEBUFFER, None);
        if status != glow::FRAMEBUFFER_COMPLETE {
            gl.delete_framebuffer(framebuffer);
            gl.delete_texture(texture);
            return Err(format!("framebuffer incomplete: 0x{status:x}"));
        }
        Ok(PlaneTarget { texture, framebuffer, width, height, offset, len })
    }
}

/// Deletes the GL objects of a set of render targets.
fn delete_targets(gl: &glow::Context, targets: Targets) {
    for plane in targets.planes {
        unsafe {
            gl.delete_framebuffer(plane.framebuffer);
            gl.delete_texture(plane.texture);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cpu::convert_to_i420;
    use crate::formats::PixelFormat;
    use crate::geometry::Rect;

    fn gradient(width: u32, height: u32) -> Vec<u8> {
        let mut image = Vec::with_capacity((width * height * 4) as usize);
        for y in 0..height {
            for x in 0..width {
                image.push((x * 255 / (width - 1)) as u8);
                image.push((y * 255 / (height - 1)) as u8);
                image.push(((x + y) * 255 / (width + height - 2)) as u8);
                image.push(255);
            }
        }
        image
    }

    fn cpu_reference(rgba: &[u8], width: u32, crop: Rect, out_width: u32, out_height: u32) -> Vec<u8> {
        let mut out = Vec::new();
        convert_to_i420(rgba, width as usize * 4, PixelFormat::Rgbx, crop, out_width, out_height, &mut out).unwrap();
        out
    }

    fn converter() -> Option<GpuConverter> {
        match GpuConverter::new() {
            Ok(converter) => Some(converter),
            Err(error) => {
                eprintln!("skipping GPU test: {error}");
                None
            }
        }
    }

    fn assert_close(actual: &[u8], expected: &[u8], tolerance: u8) {
        assert_eq!(actual.len(), expected.len());
        let worst = actual.iter().zip(expected).map(|(a, b)| a.abs_diff(*b)).max().unwrap_or(0);
        assert!(worst <= tolerance, "max difference {worst} exceeds {tolerance}");
    }

    #[test]
    fn gpu_matches_cpu_reference() {
        let Some(mut gpu) = converter() else { return };
        let image = gradient(256, 128);
        let mut out = Vec::new();
        gpu.convert_rgba(&image, 256, 128, Rect::full(256, 128), 256, 128, &mut out).unwrap();
        assert_close(&out, &cpu_reference(&image, 256, Rect::full(256, 128), 256, 128), 2);
    }

    #[test]
    fn gpu_scales_and_crops() {
        let Some(mut gpu) = converter() else { return };
        let image = gradient(512, 256);
        let crop = Rect { x: 64, y: 32, width: 256, height: 128 };
        let mut out = Vec::new();
        gpu.convert_rgba(&image, 512, 256, crop, 128, 64, &mut out).unwrap();
        assert_close(&out, &cpu_reference(&image, 512, crop, 128, 64), 3);
    }

    #[test]
    fn gpu_handles_size_change() {
        let Some(mut gpu) = converter() else { return };
        let image = gradient(256, 128);
        let mut out = Vec::new();
        gpu.convert_rgba(&image, 256, 128, Rect::full(256, 128), 128, 64, &mut out).unwrap();
        assert_eq!(out.len(), 128 * 64 * 3 / 2);
        gpu.convert_rgba(&image, 256, 128, Rect::full(256, 128), 64, 32, &mut out).unwrap();
        assert_eq!(out.len(), 64 * 32 * 3 / 2);
    }

    #[test]
    fn gpu_imports_dmabuf() {
        let Some(mut gpu) = converter() else { return };
        let image = gradient(256, 128);
        let bgra: Vec<u8> = image.chunks(4).flat_map(|p| [p[2], p[1], p[0], p[3]]).collect();
        let buffer = match gpu.test_dmabuf(PixelFormat::Bgra, 256, 128, &bgra) {
            Ok(buffer) => buffer,
            Err(error) => {
                eprintln!("skipping DMA-BUF import test: {error}");
                return;
            }
        };
        let frame = DmaBufFrame {
            width: 256,
            height: 128,
            format: PixelFormat::Bgra,
            modifier: buffer.modifier,
            planes: &buffer.planes,
            crop: Rect::full(256, 128),
        };
        let mut out = Vec::new();
        gpu.convert_dmabuf(&frame, 256, 128, &mut out).unwrap();
        assert_close(&out, &cpu_reference(&image, 256, Rect::full(256, 128), 256, 128), 2);
    }

    #[test]
    fn modifiers_listed() {
        let Some(gpu) = converter() else { return };
        assert!(!gpu.modifiers(PixelFormat::Bgrx).is_empty());
    }
}
