//! Capture session: portal handshake plus PipeWire stream on their own threads.

use std::fmt;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};
use std::thread::{self, JoinHandle};

use crate::portal;
use crate::stream::{run_stream, stop_pair, Frame, Remote, StopHandle, StreamEnd, StreamSettings};

/// What to capture: the largest output size and the frame-rate limit.
#[derive(Clone, Copy, Debug)]
pub struct CaptureOptions {
    pub max_width: u32,
    pub max_height: u32,
    pub fps: u32,
}

/// The source chosen in the portal dialog.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StartedInfo {
    pub width: u32,
    pub height: u32,
    pub source_type: String,
}

/// Events after a successful start.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CaptureEvent {
    Ended(String),
    Error(String),
}

/// Why a capture could not start.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum StartError {
    Cancelled,
    Unsupported(String),
    Failed(String),
}

impl fmt::Display for StartError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Cancelled => f.write_str("cancelled: the screen selection was cancelled"),
            Self::Unsupported(reason) => write!(f, "unsupported: {reason}"),
            Self::Failed(reason) => write!(f, "error: {reason}"),
        }
    }
}

impl std::error::Error for StartError {}

type EventSink = Arc<dyn Fn(CaptureEvent) + Send + Sync>;

/// A running capture. Dropping it stops the capture.
pub struct Capture {
    stream_stop: StopHandle,
    portal_stop: async_channel::Sender<()>,
    finished: Arc<AtomicBool>,
    threads: Vec<JoinHandle<()>>,
}

impl Capture {
    /// Shows the portal dialog and, once a source was picked, starts streaming
    /// frames to `on_frame`. Blocks until the dialog is done.
    pub fn start(
        options: CaptureOptions,
        on_frame: Box<dyn FnMut(Frame) + Send>,
        on_event: Box<dyn Fn(CaptureEvent) + Send + Sync>,
    ) -> Result<(Capture, StartedInfo), StartError> {
        let finished = Arc::new(AtomicBool::new(false));
        let emit = emit_once(finished.clone(), Arc::from(on_event));
        let (stream_stop, stream_stop_receiver) = stop_pair();
        let (portal_stop, portal_stop_receiver) = async_channel::bounded(1);
        let (opened_sender, opened_receiver) = mpsc::channel();

        let portal_thread = {
            let stream_stop = stream_stop.clone();
            let emit = emit.clone();
            thread::Builder::new()
                .name("screencast-portal".into())
                .spawn(move || {
                    futures_lite::future::block_on(async move {
                        let (session, opened) = match portal::open().await {
                            Ok(opened) => opened,
                            Err(error) => {
                                let _ = opened_sender.send(Err(error));
                                return;
                            }
                        };
                        let _ = opened_sender.send(Ok(opened));
                        if let Some(reason) = session.wait_closed(portal_stop_receiver).await {
                            stream_stop.stop();
                            emit(CaptureEvent::Ended(reason));
                        }
                    })
                })
                .map_err(|e| StartError::Failed(format!("portal thread: {e}")))?
        };

        let opened = match opened_receiver.recv() {
            Ok(Ok(opened)) => opened,
            Ok(Err(error)) => {
                let _ = portal_thread.join();
                return Err(error);
            }
            Err(_) => {
                let _ = portal_thread.join();
                return Err(StartError::Failed("portal thread ended unexpectedly".into()));
            }
        };

        let settings = StreamSettings {
            max_width: options.max_width,
            max_height: options.max_height,
            fps: options.fps,
            use_gpu: std::env::var_os("GIMODI_SCREENCAST_NO_GPU").is_none(),
        };
        let stream_thread = {
            let portal_stop = portal_stop.clone();
            let emit = emit.clone();
            thread::Builder::new().name("screencast-stream".into()).spawn(move || {
                let event = match run_stream(Remote::Fd(opened.fd), opened.node_id, settings, on_frame, stream_stop_receiver) {
                    Ok(StreamEnd::Stopped) => None,
                    Ok(StreamEnd::Ended(reason)) => Some(CaptureEvent::Ended(reason)),
                    Err(error) => Some(CaptureEvent::Error(error)),
                };
                if let Some(event) = event {
                    let _ = portal_stop.try_send(());
                    emit(event);
                }
            })
        };
        match stream_thread {
            Ok(stream_thread) => Ok((
                Capture { stream_stop, portal_stop, finished, threads: vec![portal_thread, stream_thread] },
                opened.info,
            )),
            Err(error) => {
                let _ = portal_stop.try_send(());
                let _ = portal_thread.join();
                Err(StartError::Failed(format!("stream thread: {error}")))
            }
        }
    }

    /// Stops streaming and closes the portal session. Safe to call repeatedly;
    /// no `Ended` event is emitted for a stop requested here.
    pub fn stop(&mut self) {
        self.finished.store(true, Ordering::SeqCst);
        self.stream_stop.stop();
        let _ = self.portal_stop.try_send(());
        for thread in self.threads.drain(..) {
            let _ = thread.join();
        }
    }
}

impl Drop for Capture {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Wraps an event sink so only the first event after start is delivered.
fn emit_once(finished: Arc<AtomicBool>, sink: EventSink) -> EventSink {
    Arc::new(move |event| {
        if !finished.swap(true, Ordering::SeqCst) {
            sink(event);
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn start_errors_carry_category_prefix() {
        assert!(StartError::Cancelled.to_string().starts_with("cancelled:"));
        assert_eq!(StartError::Unsupported("no portal".into()).to_string(), "unsupported: no portal");
        assert_eq!(StartError::Failed("boom".into()).to_string(), "error: boom");
    }
}
