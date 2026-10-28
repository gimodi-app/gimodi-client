//! Node.js binding for the screen capture core.

use std::sync::{Arc, Mutex};

use gimodi_screencast_core::capture::{Capture, CaptureEvent, CaptureOptions, StartedInfo};
use gimodi_screencast_core::latest::Latest;
use gimodi_screencast_core::stream::Frame;
use napi::bindgen_prelude::{AsyncTask, Buffer, Null, ToNapiValue};
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode, UnknownReturnValue};
use napi::{sys, Env, Error, Result, Status, Task};
use napi_derive::napi;

/// Requested output limits.
#[napi(object)]
pub struct StartOptions {
    pub max_width: u32,
    pub max_height: u32,
    pub fps: u32,
}

/// An I420 frame (Y, U and V planes, tightly packed).
#[napi(object)]
pub struct CaptureFrame {
    pub data: Buffer,
    pub width: u32,
    pub height: u32,
}

/// Capture lifecycle event: `ended` or `error`.
#[napi(object)]
pub struct CaptureEventMessage {
    #[napi(js_name = "type")]
    pub kind: String,
    pub message: String,
}

/// The source picked in the portal dialog.
#[napi(object)]
pub struct StartResult {
    pub width: u32,
    pub height: u32,
    pub source_type: String,
}

/// Takes the newest captured frame when JavaScript runs the frame callback, so
/// a full callback queue never holds back the latest picture. JavaScript gets
/// `null` when an earlier call already delivered it.
pub struct NewestFrame(Latest<Frame>);

impl ToNapiValue for NewestFrame {
    unsafe fn to_napi_value(env: sys::napi_env, value: Self) -> Result<sys::napi_value> {
        match value.0.take() {
            Some(frame) => {
                let message = CaptureFrame { data: Buffer::from(frame.data), width: frame.width, height: frame.height };
                unsafe { CaptureFrame::to_napi_value(env, message) }
            }
            None => unsafe { Null::to_napi_value(env, Null) },
        }
    }
}

type FrameCallback = ThreadsafeFunction<NewestFrame, UnknownReturnValue, NewestFrame, Status, false, false, 1>;
type EventCallback = ThreadsafeFunction<CaptureEventMessage, UnknownReturnValue, CaptureEventMessage, Status, false>;

/// Screen capture through the ScreenCast portal with an embedded cursor.
#[napi]
pub struct ScreenCapture {
    capture: Arc<Mutex<Option<Capture>>>,
}

#[napi]
impl ScreenCapture {
    #[napi(constructor)]
    #[allow(clippy::new_without_default)]
    pub fn new() -> Self {
        Self { capture: Arc::new(Mutex::new(None)) }
    }

    /// Shows the portal dialog and starts delivering frames to `onFrame`.
    /// Rejects with a message starting with `cancelled:`, `unsupported:` or `error:`.
    #[napi(ts_return_type = "Promise<StartResult>")]
    pub fn start(&self, options: StartOptions, on_frame: FrameCallback, on_event: EventCallback) -> AsyncTask<StartTask> {
        AsyncTask::new(StartTask { options, callbacks: Some((on_frame, on_event)), slot: self.capture.clone() })
    }

    /// Stops the running capture, if any. Safe to call repeatedly.
    #[napi]
    pub fn stop(&self) {
        let running = self.capture.lock().map(|mut slot| slot.take()).unwrap_or(None);
        if let Some(mut capture) = running {
            capture.stop();
        }
    }
}

/// Runs the blocking portal handshake on the libuv thread pool.
pub struct StartTask {
    options: StartOptions,
    callbacks: Option<(FrameCallback, EventCallback)>,
    slot: Arc<Mutex<Option<Capture>>>,
}

impl Task for StartTask {
    type Output = StartedInfo;
    type JsValue = StartResult;

    fn compute(&mut self) -> Result<StartedInfo> {
        let options = validate(&self.options)?;
        let (on_frame, on_event) = self.callbacks.take().ok_or_else(|| Error::from_reason("error: start task reused"))?;
        let newest = Latest::default();
        let frame_sink = Box::new(move |frame: Frame| {
            newest.put(frame);
            on_frame.call(NewestFrame(newest.clone()), ThreadsafeFunctionCallMode::NonBlocking);
        });
        let event_sink = Box::new(move |event: CaptureEvent| {
            let (kind, message) = match event {
                CaptureEvent::Ended(message) => ("ended", message),
                CaptureEvent::Error(message) => ("error", message),
            };
            on_event.call(CaptureEventMessage { kind: kind.into(), message }, ThreadsafeFunctionCallMode::NonBlocking);
        });
        let (capture, info) = Capture::start(options, frame_sink, event_sink).map_err(|e| Error::from_reason(e.to_string()))?;
        let previous = self.slot.lock().map(|mut slot| slot.replace(capture)).unwrap_or(None);
        if let Some(mut previous) = previous {
            previous.stop();
        }
        Ok(info)
    }

    fn resolve(&mut self, _env: Env, info: StartedInfo) -> Result<StartResult> {
        Ok(StartResult { width: info.width, height: info.height, source_type: info.source_type })
    }
}

/// Checks the options before any portal interaction.
fn validate(options: &StartOptions) -> Result<CaptureOptions> {
    if options.max_width == 0 || options.max_height == 0 || !matches!(options.fps, 30 | 60) {
        return Err(Error::from_reason("error: invalid options"));
    }
    Ok(CaptureOptions { max_width: options.max_width, max_height: options.max_height, fps: options.fps })
}
