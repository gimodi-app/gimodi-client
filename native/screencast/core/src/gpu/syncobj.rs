//! DRM timeline syncobjs for PipeWire explicit sync (`SPA_META_SyncTimeline`),
//! through `libdrm.so.2` loaded at runtime.

use std::fs::File;
use std::io;
use std::os::fd::{AsRawFd, RawFd};
use std::ptr;
use std::time::Duration;

use libloading::Library;

const DRM_CAP_SYNCOBJ_TIMELINE: u64 = 0x14;
const DRM_SYNCOBJ_WAIT_FLAGS_WAIT_FOR_SUBMIT: u32 = 1 << 1;

type GetCap = unsafe extern "C" fn(i32, u64, *mut u64) -> i32;
type FdToHandle = unsafe extern "C" fn(i32, i32, *mut u32) -> i32;
type Destroy = unsafe extern "C" fn(i32, u32) -> i32;
type TimelineWait = unsafe extern "C" fn(i32, *mut u32, *mut u64, u32, i64, u32, *mut u32) -> i32;
type TimelineSignal = unsafe extern "C" fn(i32, *const u32, *mut u64, u32) -> i32;

/// Waits for and signals points on timeline syncobjs shared by a producer.
pub struct Timelines {
    _library: Library,
    node: File,
    fd_to_handle: FdToHandle,
    destroy: Destroy,
    timeline_wait: TimelineWait,
    timeline_signal: TimelineSignal,
}

impl Timelines {
    /// Loads libdrm and checks that the DRM device behind `node` supports
    /// timeline syncobjs.
    pub fn new(node: &File) -> Result<Self, String> {
        let node = node.try_clone().map_err(|e| format!("render node: {e}"))?;
        unsafe {
            let library = Library::new("libdrm.so.2").map_err(|e| format!("libdrm: {e}"))?;
            let get_cap = *library.get::<GetCap>(b"drmGetCap\0").map_err(|e| format!("drmGetCap: {e}"))?;
            let fd_to_handle =
                *library.get::<FdToHandle>(b"drmSyncobjFDToHandle\0").map_err(|e| format!("drmSyncobjFDToHandle: {e}"))?;
            let destroy = *library.get::<Destroy>(b"drmSyncobjDestroy\0").map_err(|e| format!("drmSyncobjDestroy: {e}"))?;
            let timeline_wait =
                *library.get::<TimelineWait>(b"drmSyncobjTimelineWait\0").map_err(|e| format!("drmSyncobjTimelineWait: {e}"))?;
            let timeline_signal = *library
                .get::<TimelineSignal>(b"drmSyncobjTimelineSignal\0")
                .map_err(|e| format!("drmSyncobjTimelineSignal: {e}"))?;
            let mut supported = 0;
            if get_cap(node.as_raw_fd(), DRM_CAP_SYNCOBJ_TIMELINE, &mut supported) != 0 || supported == 0 {
                return Err("the DRM device has no timeline syncobjs".into());
            }
            Ok(Self { _library: library, node, fd_to_handle, destroy, timeline_wait, timeline_signal })
        }
    }

    /// Blocks until `point` of the syncobj behind `syncobj_fd` is signalled.
    /// Returns whether it had to wait, or an error after `timeout`.
    pub fn wait(&self, syncobj_fd: RawFd, point: u64, timeout: Duration) -> Result<bool, String> {
        self.with_handle(syncobj_fd, |handle| {
            if self.wait_until(handle, point, monotonic_now()).is_ok() {
                return Ok(false);
            }
            let deadline = monotonic_now().saturating_add(timeout.as_nanos().try_into().unwrap_or(i64::MAX));
            self.wait_until(handle, point, deadline).map(|()| true)
        })
    }

    /// Signals `point` of the syncobj behind `syncobj_fd`.
    pub fn signal(&self, syncobj_fd: RawFd, point: u64) -> Result<(), String> {
        self.with_handle(syncobj_fd, |handle| {
            let mut points = [point];
            match unsafe { (self.timeline_signal)(self.node.as_raw_fd(), &handle, points.as_mut_ptr(), 1) } {
                0 => Ok(()),
                _ => Err(format!("syncobj signal: {}", io::Error::last_os_error())),
            }
        })
    }

    /// Waits for `point` until the absolute `CLOCK_MONOTONIC` `deadline` (ns).
    fn wait_until(&self, handle: u32, point: u64, deadline: i64) -> Result<(), String> {
        let mut handles = [handle];
        let mut points = [point];
        let result = unsafe {
            (self.timeline_wait)(
                self.node.as_raw_fd(),
                handles.as_mut_ptr(),
                points.as_mut_ptr(),
                1,
                deadline,
                DRM_SYNCOBJ_WAIT_FLAGS_WAIT_FOR_SUBMIT,
                ptr::null_mut(),
            )
        };
        match result {
            0 => Ok(()),
            _ => Err(format!("syncobj wait: {}", io::Error::last_os_error())),
        }
    }

    /// Imports `syncobj_fd` as a handle for the duration of `action`.
    fn with_handle<T>(&self, syncobj_fd: RawFd, action: impl FnOnce(u32) -> Result<T, String>) -> Result<T, String> {
        let mut handle = 0;
        if unsafe { (self.fd_to_handle)(self.node.as_raw_fd(), syncobj_fd, &mut handle) } != 0 {
            return Err(format!("syncobj import: {}", io::Error::last_os_error()));
        }
        let result = action(handle);
        unsafe { (self.destroy)(self.node.as_raw_fd(), handle) };
        result
    }
}

/// Current `CLOCK_MONOTONIC` time in nanoseconds, the clock of syncobj deadlines.
fn monotonic_now() -> i64 {
    let mut now = libc::timespec { tv_sec: 0, tv_nsec: 0 };
    unsafe { libc::clock_gettime(libc::CLOCK_MONOTONIC, &mut now) };
    now.tv_sec * 1_000_000_000 + now.tv_nsec
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::{File, OpenOptions};
    use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
    use std::thread;
    use std::time::Duration;

    use libloading::Library;

    type SyncobjCreate = unsafe extern "C" fn(i32, u32, *mut u32) -> i32;
    type SyncobjHandleToFd = unsafe extern "C" fn(i32, u32, *mut i32) -> i32;

    fn render_node() -> Option<File> {
        OpenOptions::new().read(true).write(true).open("/dev/dri/renderD128").ok()
    }

    /// A new, unsignalled timeline syncobj on `node`, exported as an fd.
    fn new_syncobj(node: &File) -> OwnedFd {
        unsafe {
            let library = Library::new("libdrm.so.2").unwrap();
            let create = *library.get::<SyncobjCreate>(b"drmSyncobjCreate\0").unwrap();
            let to_fd = *library.get::<SyncobjHandleToFd>(b"drmSyncobjHandleToFD\0").unwrap();
            let mut handle = 0;
            assert_eq!(create(node.as_raw_fd(), 0, &mut handle), 0);
            let mut fd = -1;
            assert_eq!(to_fd(node.as_raw_fd(), handle, &mut fd), 0);
            OwnedFd::from_raw_fd(fd)
        }
    }

    fn timelines(node: &File) -> Option<Timelines> {
        match Timelines::new(node) {
            Ok(timelines) => Some(timelines),
            Err(error) => {
                eprintln!("skipping syncobj test: {error}");
                None
            }
        }
    }

    #[test]
    fn wait_succeeds_only_after_the_point_is_signalled() {
        let Some(node) = render_node() else { return };
        let Some(timelines) = timelines(&node) else { return };
        let syncobj = new_syncobj(&node);
        assert!(timelines.wait(syncobj.as_raw_fd(), 1, Duration::from_millis(20)).is_err());
        timelines.signal(syncobj.as_raw_fd(), 1).unwrap();
        assert_eq!(timelines.wait(syncobj.as_raw_fd(), 1, Duration::from_millis(20)), Ok(false));
        assert!(timelines.wait(syncobj.as_raw_fd(), 2, Duration::from_millis(20)).is_err());
    }

    #[test]
    fn wait_reports_that_it_blocked_for_a_later_signal() {
        let Some(node) = render_node() else { return };
        let Some(timelines) = timelines(&node) else { return };
        let syncobj = new_syncobj(&node);
        let fd = syncobj.as_raw_fd();
        thread::scope(|scope| {
            scope.spawn(|| {
                thread::sleep(Duration::from_millis(30));
                timelines.signal(fd, 1).unwrap();
            });
            assert_eq!(timelines.wait(fd, 1, Duration::from_secs(2)), Ok(true));
        });
    }
}
