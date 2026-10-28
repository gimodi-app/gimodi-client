//! Live test against GNOME's org.gnome.Mutter.ScreenCast API (no portal dialog).
//!
//! Run on a GNOME session with something animating on the monitor:
//! `cargo test --test mutter_stream -- --ignored --nocapture --test-threads=1`
//! `SCREENCAST_TEST_CONNECTOR` picks the monitor (default `DP-1`),
//! `SCREENCAST_TEST_MIN_FRAMES` the frames required within 3 s (default 1) and
//! `SCREENCAST_TEST_FPS` the requested maximum frame rate (default 30).

use std::collections::HashMap;
use std::process::Command;
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

fn connector() -> String {
    std::env::var("SCREENCAST_TEST_CONNECTOR").unwrap_or_else(|_| "DP-1".into())
}

fn capture<T: Send + 'static>(use_gpu: bool, duration: Duration, inspect: fn(&Frame) -> T) -> Vec<T> {
    let connection = Connection::session().unwrap();
    let (session, node_id) = start_mutter_stream(&connection, &connector());
    let frames = Arc::new(Mutex::new(Vec::new()));
    let sink = frames.clone();
    let (stop, receiver) = stop_pair();
    let fps = std::env::var("SCREENCAST_TEST_FPS").ok().and_then(|v| v.parse().ok()).unwrap_or(30);
    let settings = StreamSettings { max_width: 1920, max_height: 1080, fps, use_gpu };
    let worker = thread::spawn(move || {
        let on_frame = Box::new(move |frame: Frame| sink.lock().unwrap().push(inspect(&frame)));
        run_stream(Remote::Default, node_id, settings, on_frame, receiver)
    });
    thread::sleep(duration);
    stop.stop();
    let end = worker.join().unwrap();
    proxy(&connection, &session, "org.gnome.Mutter.ScreenCast.Session").call::<_, _, ()>("Stop", &()).unwrap();
    assert_eq!(end, Ok(StreamEnd::Stopped));
    let frames = std::mem::take(&mut *frames.lock().unwrap());
    frames
}

fn frame_shape(frame: &Frame) -> (u32, u32, usize) {
    (frame.width, frame.height, frame.data.len())
}

/// Left edge of the white bar drawn by `fixtures/moving_bar.py`: the median
/// over a few rows, so the embedded cursor cannot hide or fake it.
fn bar_position(frame: &Frame) -> (u32, Option<u32>) {
    let width = frame.width as usize;
    let mut edges: Vec<u32> = (1..=4)
        .filter_map(|part| {
            let row = frame.height as usize * part / 5;
            let luma = &frame.data[row * width..(row + 1) * width];
            luma.iter().position(|&y| y > 180).map(|x| x as u32)
        })
        .collect();
    edges.sort_unstable();
    (frame.width, edges.get(edges.len() / 2).copied())
}

/// Frames whose bar is further left than in the frame before, apart from the
/// wrap-around at the right edge.
fn backward_steps(positions: &[(u32, Option<u32>)]) -> Vec<(u32, u32)> {
    let edges: Vec<(u32, u32)> = positions.iter().filter_map(|&(width, edge)| edge.map(|x| (width, x))).collect();
    edges
        .windows(2)
        .filter(|pair| {
            let ((width, before), (_, after)) = (pair[0], pair[1]);
            let wrapped = before > width / 2 && after < width * 3 / 10;
            after + (width / 400).max(4) < before && !wrapped
        })
        .map(|pair| (pair[0].1, pair[1].1))
        .collect()
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
    assert_frames(&capture(true, Duration::from_secs(3), frame_shape));
}

#[test]
#[ignore]
fn mutter_stream_delivers_frames_on_cpu() {
    assert_frames(&capture(false, Duration::from_secs(3), frame_shape));
}

/// Needs GTK 4 for Python; covers the monitor with a moving bar for 9 s.
#[test]
#[ignore]
fn gpu_frames_never_show_an_older_picture() {
    let fixture = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/moving_bar.py");
    let mut window = Command::new("python3").args(["-I", fixture, &connector(), "9"]).spawn().unwrap();
    thread::sleep(Duration::from_millis(2000));
    let positions = capture(true, Duration::from_secs(6), bar_position);
    window.kill().unwrap();
    window.wait().unwrap();
    let found = positions.iter().filter(|(_, edge)| edge.is_some()).count();
    let backward = backward_steps(&positions);
    println!("{} frames, bar found in {found}, backward steps {backward:?}", positions.len());
    assert!(found >= 60, "bar found in only {found} frames");
    assert!(backward.is_empty(), "{} frames showed an older picture: {backward:?}", backward.len());
}
