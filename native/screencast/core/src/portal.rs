//! ScreenCast portal session requesting an embedded cursor.

use std::os::fd::OwnedFd;

use ashpd::desktop::screencast::{CursorMode, Screencast, SelectSourcesOptions, SourceType};
use ashpd::desktop::{PersistMode, ResponseError, Session};
use futures_lite::StreamExt;

use crate::capture::{StartError, StartedInfo};

/// A portal session that stays open while its stream is captured.
pub struct PortalSession {
    session: Session<Screencast>,
}

/// The source the user picked in the portal dialog.
pub struct OpenedStream {
    pub info: StartedInfo,
    pub node_id: u32,
    pub fd: OwnedFd,
}

/// Shows the portal dialog and opens the PipeWire remote of the chosen source.
pub async fn open() -> Result<(PortalSession, OpenedStream), StartError> {
    let proxy = Screencast::new().await.map_err(|e| map_error(&e))?;
    let modes = proxy.available_cursor_modes().await.map_err(|e| map_error(&e))?;
    if !modes.contains(CursorMode::Embedded) {
        return Err(StartError::Unsupported("portal does not offer an embedded cursor".into()));
    }
    let session = proxy.create_session(Default::default()).await.map_err(|e| map_error(&e))?;
    match select_and_start(&proxy, &session).await {
        Ok(opened) => Ok((PortalSession { session }, opened)),
        Err(error) => {
            let _ = session.close().await;
            Err(error)
        }
    }
}

/// Selects sources with an embedded cursor, starts the session and opens its remote.
async fn select_and_start(proxy: &Screencast, session: &Session<Screencast>) -> Result<OpenedStream, StartError> {
    let options = SelectSourcesOptions::default()
        .set_cursor_mode(CursorMode::Embedded)
        .set_sources(SourceType::Monitor | SourceType::Window)
        .set_multiple(false)
        .set_persist_mode(PersistMode::DoNot);
    proxy
        .select_sources(session, options)
        .await
        .and_then(|request| request.response())
        .map_err(|e| map_error(&e))?;
    let streams = proxy
        .start(session, None, Default::default())
        .await
        .and_then(|request| request.response())
        .map_err(|e| map_error(&e))?;
    let stream = streams.streams().first().ok_or_else(|| StartError::Failed("portal returned no stream".into()))?;
    let (width, height) = stream.size().map_or((0, 0), |(w, h)| (w.max(0) as u32, h.max(0) as u32));
    let source_type = match stream.source_type() {
        Some(SourceType::Monitor) => "monitor",
        Some(SourceType::Window) => "window",
        _ => "unknown",
    };
    let fd = proxy.open_pipe_wire_remote(session, Default::default()).await.map_err(|e| map_error(&e))?;
    Ok(OpenedStream {
        info: StartedInfo { width, height, source_type: source_type.into() },
        node_id: stream.pipe_wire_node_id(),
        fd,
    })
}

impl PortalSession {
    /// Waits for the portal to close the session (returns the reason) or for
    /// `stop` (returns `None`), then closes the session.
    pub async fn wait_closed(&self, stop: async_channel::Receiver<()>) -> Option<String> {
        let closed = async {
            match self.session.receive_closed().await {
                Ok(mut signals) => {
                    signals.next().await;
                    Some("portal session closed".to_string())
                }
                Err(error) => {
                    eprintln!("[screencast] cannot watch the portal session: {error}");
                    std::future::pending().await
                }
            }
        };
        let stopped = async {
            let _ = stop.recv().await;
            None
        };
        let reason = futures_lite::future::or(closed, stopped).await;
        let _ = self.session.close().await;
        reason
    }
}

/// Classifies a portal error for the caller.
pub fn map_error(error: &ashpd::Error) -> StartError {
    match error {
        ashpd::Error::Response(ResponseError::Cancelled) | ashpd::Error::Portal(ashpd::PortalError::Cancelled(_)) => StartError::Cancelled,
        ashpd::Error::PortalNotFound(_) | ashpd::Error::RequiresVersion(..) => StartError::Unsupported(error.to_string()),
        _ => StartError::Failed(error.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ashpd::desktop::ResponseError;
    use ashpd::zbus::names::OwnedInterfaceName;

    #[test]
    fn cancelled_response_maps_to_cancelled() {
        assert!(matches!(map_error(&ashpd::Error::Response(ResponseError::Cancelled)), StartError::Cancelled));
    }

    #[test]
    fn missing_portal_maps_to_unsupported() {
        let name = OwnedInterfaceName::try_from("org.freedesktop.portal.ScreenCast").unwrap();
        assert!(matches!(map_error(&ashpd::Error::PortalNotFound(name)), StartError::Unsupported(_)));
    }

    #[test]
    fn other_failures_map_to_failed() {
        assert!(matches!(map_error(&ashpd::Error::Response(ResponseError::Other)), StartError::Failed(_)));
        assert!(matches!(map_error(&ashpd::Error::NoResponse), StartError::Failed(_)));
    }
}
