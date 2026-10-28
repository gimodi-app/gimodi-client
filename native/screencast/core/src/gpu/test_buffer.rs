//! GBM buffer objects filled from the CPU, used to test DMA-BUF import.

use std::ffi::c_void;
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
use std::ptr;

use super::egl::Egl;
use super::DmaBufPlane;

const GBM_BO_USE_RENDERING: u32 = 1 << 2;
const GBM_BO_USE_LINEAR: u32 = 1 << 4;
const GBM_BO_TRANSFER_WRITE: u32 = 1 << 1;

type BoCreate = unsafe extern "C" fn(*mut c_void, u32, u32, u32, u32) -> *mut c_void;
type BoMap = unsafe extern "C" fn(*mut c_void, u32, u32, u32, u32, u32, *mut u32, *mut *mut c_void) -> *mut c_void;
type BoUnmap = unsafe extern "C" fn(*mut c_void, *mut c_void);
type BoGetFd = unsafe extern "C" fn(*mut c_void) -> i32;
type BoGetU32 = unsafe extern "C" fn(*mut c_void) -> u32;
type BoGetModifier = unsafe extern "C" fn(*mut c_void) -> u64;
type BoGetOffset = unsafe extern "C" fn(*mut c_void, i32) -> u32;
type BoDestroy = unsafe extern "C" fn(*mut c_void);

/// A linear GBM buffer exported as a single-plane DMA-BUF.
pub struct TestDmaBuf {
    pub modifier: u64,
    pub planes: Vec<DmaBufPlane>,
    _fd: OwnedFd,
    bo: *mut c_void,
    destroy: BoDestroy,
}

impl TestDmaBuf {
    /// Allocates a buffer of `fourcc` and copies `pixels` (tightly packed) into it.
    pub fn new(egl: &Egl, fourcc: u32, width: u32, height: u32, pixels: &[u8]) -> Result<Self, String> {
        let library = &egl.gbm._library;
        let symbol = |name: &[u8]| -> Result<*mut c_void, String> {
            unsafe { library.get::<*mut c_void>(name) }
                .map(|s| *s)
                .map_err(|e| format!("{}: {e}", String::from_utf8_lossy(name)))
        };
        unsafe {
            let create: BoCreate = std::mem::transmute(symbol(b"gbm_bo_create\0")?);
            let map: BoMap = std::mem::transmute(symbol(b"gbm_bo_map\0")?);
            let unmap: BoUnmap = std::mem::transmute(symbol(b"gbm_bo_unmap\0")?);
            let get_fd: BoGetFd = std::mem::transmute(symbol(b"gbm_bo_get_fd\0")?);
            let get_stride: BoGetU32 = std::mem::transmute(symbol(b"gbm_bo_get_stride\0")?);
            let get_modifier: BoGetModifier = std::mem::transmute(symbol(b"gbm_bo_get_modifier\0")?);
            let get_offset: BoGetOffset = std::mem::transmute(symbol(b"gbm_bo_get_offset\0")?);
            let destroy: BoDestroy = std::mem::transmute(symbol(b"gbm_bo_destroy\0")?);

            let bo = [GBM_BO_USE_LINEAR | GBM_BO_USE_RENDERING, GBM_BO_USE_LINEAR, GBM_BO_USE_RENDERING, 0]
                .into_iter()
                .map(|flags| create(egl.device, width, height, fourcc, flags))
                .find(|bo| !bo.is_null())
                .ok_or("gbm_bo_create failed for all usage flags")?;
            let mut stride = 0u32;
            let mut map_data = ptr::null_mut();
            let mapped = map(bo, 0, 0, width, height, GBM_BO_TRANSFER_WRITE, &mut stride, &mut map_data);
            if mapped.is_null() {
                destroy(bo);
                return Err("gbm_bo_map failed".into());
            }
            let row = width as usize * 4;
            for y in 0..height as usize {
                ptr::copy_nonoverlapping(pixels[y * row..].as_ptr(), (mapped as *mut u8).add(y * stride as usize), row);
            }
            unmap(bo, map_data);
            let raw_fd = get_fd(bo);
            if raw_fd < 0 {
                destroy(bo);
                return Err("gbm_bo_get_fd failed".into());
            }
            let fd = OwnedFd::from_raw_fd(raw_fd);
            let plane = DmaBufPlane { fd: fd.as_raw_fd(), offset: get_offset(bo, 0), stride: get_stride(bo) };
            Ok(Self {
                modifier: get_modifier(bo),
                planes: vec![plane],
                _fd: fd,
                bo,
                destroy,
            })
        }
    }
}

impl Drop for TestDmaBuf {
    fn drop(&mut self) {
        unsafe { (self.destroy)(self.bo) };
    }
}
