//! Live test against GNOME's org.gnome.Mutter.ScreenCast API (no portal dialog).
//!
//! Run on a GNOME session with something animating on the monitor:
//! `cargo test --test mutter_stream -- --ignored --nocapture --test-threads=1`
//! `SCREENCAST_TEST_CONNECTOR` picks the monitor (default `DP-1`) and
//! `SCREENCAST_TEST_MIN_FRAMES` the frames required within 3 s (default 1).

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use gimodi_screencast_core::stream::{run_stream, stop_pair, Frame, Remote, StreamEnd, StreamSettings};
use zbus::blocking::{Connection, Proxy};
use zbus::zvariant::{OwnedObjectPath, Value};

const SERVICE: &str = "org.gnome.Mutter.ScreenCast";
const EMBEDDED_CURSOR: u32 = 1;

fn proxy(connection: &Connection, path: &OwnedObjectPath, interface: &'static str) -> Proxy<'static> {
    Proxy::new(connection, SERVICE, path.to_string(), interface).unwrap()
}

fn start_mutter_stream(connection: &Connection, connector: &str) -> (OwnedObjectPath, u32) {
    let root = OwnedObjectPath::try_from("/org/gnome/Mutter/ScreenCast").unwrap();
    let screen_cast = proxy(connection, &root, "org.gnome.Mutter.ScreenCast");
    let session: OwnedObjectPath = screen_cast.call("CreateSession", &(HashMap::<&str, Value>::new(),)).unwrap();
    let session_proxy = proxy(connection, &session, "org.gnome.Mutter.ScreenCast.Session");
    let properties = HashMap::from([("cursor-mode", Value::U32(EMBEDDED_CURSOR))]);
    let stream: OwnedObjectPath = session_proxy.call("RecordMonitor", &(connector, properties)).unwrap();
    let stream_proxy = proxy(connection, &stream, "org.gnome.Mutter.ScreenCast.Stream");
    let mut added = stream_proxy.receive_signal("PipeWireStreamAdded").unwrap();
    session_proxy.call::<_, _, ()>("Start", &()).unwrap();
    let node_id: u32 = added.next().unwrap().body().deserialize().unwrap();
    (session, node_id)
}

fn capture(use_gpu: bool) -> Vec<(u32, u32, usize)> {
    let connector = std::env::var("SCREENCAST_TEST_CONNECTOR").unwrap_or_else(|_| "DP-1".into());
    let connection = Connection::session().unwrap();
    let (session, node_id) = start_mutter_stream(&connection, &connector);
    let frames = Arc::new(Mutex::new(Vec::new()));
    let sink = frames.clone();
    let (stop, receiver) = stop_pair();
    let settings = StreamSettings { max_width: 1920, max_height: 1080, fps: 30, use_gpu };
    let worker = thread::spawn(move || {
        let on_frame = Box::new(move |frame: Frame| sink.lock().unwrap().push((frame.width, frame.height, frame.data.len())));
        run_stream(Remote::Default, node_id, settings, on_frame, receiver)
    });
    thread::sleep(Duration::from_secs(3));
    stop.stop();
    let end = worker.join().unwrap();
    proxy(&connection, &session, "org.gnome.Mutter.ScreenCast.Session").call::<_, _, ()>("Stop", &()).unwrap();
    assert_eq!(end, Ok(StreamEnd::Stopped));
    let frames = frames.lock().unwrap().clone();
    frames
}

fn assert_frames(frames: &[(u32, u32, usize)]) {
    let minimum = std::env::var("SCREENCAST_TEST_MIN_FRAMES").ok().and_then(|v| v.parse().ok()).unwrap_or(1);
    println!("received {} frames, first {:?}", frames.len(), frames.first());
    assert!(frames.len() >= minimum, "{} frames < {minimum}", frames.len());
    for &(width, height, len) in frames {
        assert!(width <= 1920 && height <= 1080 && width % 8 == 0 && height % 2 == 0);
        assert_eq!(len, (width * height * 3 / 2) as usize);
    }
}

#[test]
#[ignore]
fn mutter_stream_delivers_frames_on_gpu() {
    assert_frames(&capture(true));
}

#[test]
#[ignore]
fn mutter_stream_delivers_frames_on_cpu() {
    assert_frames(&capture(false));
}
