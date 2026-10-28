//! PipeWire consumer for a screen cast node: negotiates DMA-BUF (with shm
//! fallback), converts the newest buffer to I420 and hands it out.

use std::cell::RefCell;
use std::collections::HashSet;
use std::io::Cursor;
use std::os::fd::{OwnedFd, RawFd};
use std::rc::Rc;
use std::time::Duration;

use pipewire as pw;
use pw::buffer::Buffer;
use pw::properties::properties;
use pw::spa;
use pw::stream::{Stream, StreamBox, StreamFlags, StreamState};
use spa::buffer::meta::{MetaHeader, MetaHeaderFlags, MetaVideoCrop, Metadata};
use spa::buffer::{ChunkFlags, Data, DataType};
use spa::param::format::{MediaSubtype, MediaType};
use spa::param::format_utils;
use spa::param::video::VideoInfoRaw;
use spa::param::ParamType;
use spa::pod::deserialize::PodDeserializer;
use spa::pod::serialize::PodSerializer;
use spa::pod::{ChoiceValue, Object, Pod, Property, PropertyFlags, Value};
use spa::sys;
use spa::utils::{Choice, ChoiceEnum, ChoiceFlags, Direction, Fraction, Id, Rectangle, SpaTypes};

use crate::cpu;
use crate::formats::PixelFormat;
use crate::geometry::{crop_rect, fit_output_size, Rect};
use crate::gpu::{DmaBufFrame, DmaBufPlane, GpuConverter, DRM_FORMAT_MOD_INVALID};

const MAX_DIMENSION: u32 = 8192;
const BYTES_PER_PIXEL: usize = 4;
const ACQUIRE_TIMEOUT: Duration = Duration::from_millis(100);

/// An I420 frame (Y, then U, then V plane, tightly packed).
pub struct Frame {
    pub width: u32,
    pub height: u32,
    pub data: Vec<u8>,
}

/// Output limits and conversion choice for one stream.
#[derive(Clone, Copy, Debug)]
pub struct StreamSettings {
    pub max_width: u32,
    pub max_height: u32,
    pub fps: u32,
    pub use_gpu: bool,
}

/// The PipeWire daemon to connect to.
pub enum Remote {
    /// A remote opened by the ScreenCast portal.
    Fd(OwnedFd),
    /// The session's default PipeWire daemon.
    Default,
}

/// Why [`run_stream`] returned.
#[derive(Debug, PartialEq, Eq)]
pub enum StreamEnd {
    Stopped,
    Ended(String),
}

/// Asks a running [`run_stream`] to return. Can be used from any thread.
#[derive(Clone)]
pub struct StopHandle(pw::channel::Sender<()>);

impl StopHandle {
    /// Requests the stream loop to stop; repeated calls are harmless.
    pub fn stop(&self) {
        let _ = self.0.send(());
    }
}

/// Receiving end of a [`StopHandle`], consumed by [`run_stream`].
pub struct StopReceiver(pw::channel::Receiver<()>);

/// Creates a connected stop handle and receiver.
pub fn stop_pair() -> (StopHandle, StopReceiver) {
    let (sender, receiver) = pw::channel::channel();
    (StopHandle(sender), StopReceiver(receiver))
}

/// Format agreed on with the producer.
#[derive(Clone, Copy)]
struct NegotiatedFormat {
    pixel: PixelFormat,
    width: u32,
    height: u32,
    modifier: Option<u64>,
}

/// `SPA_META_SyncTimeline`, read through pipewire-rs.
#[repr(transparent)]
struct SyncTimeline(sys::spa_meta_sync_timeline);

impl Metadata for SyncTimeline {
    const META_TYPE: u32 = sys::SPA_META_SyncTimeline;
}

/// Explicit-sync points of one buffer: wait for the acquire point before
/// reading it, signal the release point when done with it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct SyncPoints {
    acquire_fd: RawFd,
    acquire_point: u64,
    release_fd: RawFd,
    release_point: u64,
}

/// Per-stream state owned by the PipeWire listener.
struct State {
    settings: StreamSettings,
    on_frame: Box<dyn FnMut(Frame) + Send>,
    gpu: Option<GpuConverter>,
    format: Option<NegotiatedFormat>,
    blacklist: HashSet<u64>,
    synced_frames: u64,
    early_frames: u64,
}

/// Connects to `node_id` and delivers converted frames until stopped or the
/// stream ends.
pub fn run_stream(
    remote: Remote,
    node_id: u32,
    settings: StreamSettings,
    on_frame: Box<dyn FnMut(Frame) + Send>,
    stop: StopReceiver,
) -> Result<StreamEnd, String> {
    pw::init();
    let mainloop = pw::main_loop::MainLoopRc::new(None).map_err(|e| format!("main loop: {e}"))?;
    let context = pw::context::ContextRc::new(&mainloop, None).map_err(|e| format!("context: {e}"))?;
    let core = match remote {
        Remote::Fd(fd) => context.connect_fd_rc(fd, None),
        Remote::Default => context.connect_rc(None),
    }
    .map_err(|e| format!("connect: {e}"))?;
    let stream = StreamBox::new(
        &core,
        "gimodi-screencast",
        properties! {
            *pw::keys::MEDIA_TYPE => "Video",
            *pw::keys::MEDIA_CATEGORY => "Capture",
            *pw::keys::MEDIA_ROLE => "Screen",
        },
    )
    .map_err(|e| format!("stream: {e}"))?;

    let gpu = if settings.use_gpu { create_gpu() } else { None };
    let enum_formats = build_enum_formats(settings.fps, &|format| supported_modifiers(gpu.as_ref(), format), &HashSet::new());
    let end = Rc::new(RefCell::new(None));
    let state = State { settings, on_frame, gpu, format: None, blacklist: HashSet::new(), synced_frames: 0, early_frames: 0 };

    let _listener = stream
        .add_local_listener_with_user_data(state)
        .state_changed({
            let end = end.clone();
            let mainloop = mainloop.clone();
            move |_, _, old, new| on_state_changed(&end, &mainloop, old, new)
        })
        .param_changed(|stream, state, id, param| state.on_param_changed(stream, id, param))
        .process(|stream, state| state.on_process(stream))
        .register()
        .map_err(|e| format!("listener: {e}"))?;

    let mut params = pods(&enum_formats)?;
    stream
        .connect(Direction::Input, Some(node_id), StreamFlags::AUTOCONNECT | StreamFlags::MAP_BUFFERS, &mut params)
        .map_err(|e| format!("stream connect: {e}"))?;

    let _stop = stop.0.attach(mainloop.loop_(), {
        let end = end.clone();
        let mainloop = mainloop.clone();
        move |()| {
            end.borrow_mut().get_or_insert(StreamEnd::Stopped);
            mainloop.quit();
        }
    });
    mainloop.run();
    let _ = stream.disconnect();
    let result = end.borrow_mut().take().unwrap_or(StreamEnd::Stopped);
    Ok(result)
}

/// Ends the loop when the stream fails or is disconnected by the producer.
fn on_state_changed(end: &Rc<RefCell<Option<StreamEnd>>>, mainloop: &pw::main_loop::MainLoopRc, old: StreamState, new: StreamState) {
    let reason = match new {
        StreamState::Error(message) => Some(format!("stream error: {message}")),
        StreamState::Unconnected if !matches!(old, StreamState::Connecting) => Some("stream disconnected".to_string()),
        _ => None,
    };
    if let Some(reason) = reason {
        end.borrow_mut().get_or_insert(StreamEnd::Ended(reason));
        mainloop.quit();
    }
}

/// Initialises the GPU converter, logging why it is unavailable.
fn create_gpu() -> Option<GpuConverter> {
    match GpuConverter::new() {
        Ok(gpu) => Some(gpu),
        Err(error) => {
            eprintln!("[screencast] GPU conversion unavailable, using shared memory: {error}");
            None
        }
    }
}

/// Modifiers to offer for a format; none without a GPU converter.
fn supported_modifiers(gpu: Option<&GpuConverter>, format: PixelFormat) -> Vec<u64> {
    gpu.map(|gpu| gpu.modifiers(format)).unwrap_or_default()
}

impl State {
    /// Records the negotiated format and requests matching buffers and metadata.
    fn on_param_changed(&mut self, stream: &Stream, id: u32, param: Option<&Pod>) {
        if id != ParamType::Format.as_raw() {
            return;
        }
        let Some(param) = param else { return };
        let Ok((media_type, media_subtype)) = format_utils::parse_format(param) else { return };
        if media_type != MediaType::Video || media_subtype != MediaSubtype::Raw {
            return;
        }
        let mut info = VideoInfoRaw::default();
        if info.parse(param).is_err() {
            return;
        }
        let Some(pixel) = PixelFormat::from_spa(info.format().as_raw()) else {
            eprintln!("[screencast] unsupported pixel format {:?}", info.format());
            return;
        };
        let modifier = has_modifier(param).then(|| info.modifier());
        let size = info.size();
        self.format = Some(NegotiatedFormat { pixel, width: size.width, height: size.height, modifier });
        let explicit_sync = self.gpu.as_ref().is_some_and(|gpu| gpu.timelines().is_some());
        let buffers = buffer_params(modifier.is_some(), explicit_sync);
        match pods(&buffers) {
            Ok(mut params) => {
                if let Err(error) = stream.update_params(&mut params) {
                    eprintln!("[screencast] update_params failed: {error}");
                }
            }
            Err(error) => eprintln!("[screencast] {error}"),
        }
    }

    /// Converts the newest queued buffer that carries a picture and hands it
    /// to `on_frame`. Signals the release point of every dequeued buffer, as
    /// the producer reuses a buffer only after that.
    fn on_process(&mut self, stream: &Stream) {
        let mut newest: Option<(Buffer, Option<SyncPoints>)> = None;
        while let Some(mut buffer) = stream.dequeue_buffer() {
            let points = buffer.find_meta::<SyncTimeline>().map(|meta| (meta.0.acquire_point, meta.0.release_point));
            let sync = sync_points(points, buffer.datas_mut());
            if buffer_has_content(&mut buffer) {
                if let Some((_, older)) = newest.replace((buffer, sync)) {
                    self.release(older);
                }
            } else {
                self.release(sync);
            }
        }
        let Some((mut buffer, sync)) = newest else { return };
        if self.acquire(sync) {
            self.convert(stream, &mut buffer);
        }
        self.release(sync);
    }

    /// Waits until the producer has finished writing a buffer. Returns false
    /// when that failed and the buffer must not be read.
    fn acquire(&mut self, sync: Option<SyncPoints>) -> bool {
        let (Some(points), Some(timelines)) = (sync, self.gpu.as_ref().and_then(GpuConverter::timelines)) else {
            return true;
        };
        match timelines.wait(points.acquire_fd, points.acquire_point, ACQUIRE_TIMEOUT) {
            Ok(waited) => {
                self.synced_frames += 1;
                self.early_frames += u64::from(waited);
                true
            }
            Err(error) => {
                eprintln!("[screencast] frame dropped: {error}");
                false
            }
        }
    }

    /// Tells the producer that a buffer is no longer read.
    fn release(&self, sync: Option<SyncPoints>) {
        let (Some(points), Some(timelines)) = (sync, self.gpu.as_ref().and_then(GpuConverter::timelines)) else {
            return;
        };
        if let Err(error) = timelines.signal(points.release_fd, points.release_point) {
            eprintln!("[screencast] {error}");
        }
    }

    /// Converts the picture of a buffer and hands it to `on_frame`.
    fn convert(&mut self, stream: &Stream, buffer: &mut Buffer) {
        let Some(format) = self.format else { return };
        let crop = crop_rect(format.width, format.height, buffer.find_meta::<MetaVideoCrop>().and_then(crop_from_meta));
        let (out_width, out_height) = fit_output_size(crop.width, crop.height, self.settings.max_width, self.settings.max_height);
        let datas = buffer.datas_mut();
        let Some(first) = datas.first() else { return };
        let mut out = Vec::new();
        let converted = match first.type_() {
            DataType::DmaBuf => self.convert_dmabuf(stream, format, datas, crop, out_width, out_height, &mut out),
            DataType::MemFd | DataType::MemPtr => convert_shm(format, &mut datas[0], crop, out_width, out_height, &mut out),
            other => Err(format!("unsupported buffer type {other:?}")),
        };
        match converted {
            Ok(true) => (self.on_frame)(Frame { width: out_width, height: out_height, data: out }),
            Ok(false) => {}
            Err(error) => eprintln!("[screencast] frame dropped: {error}"),
        }
    }

    /// Converts a DMA-BUF on the GPU; on import failure the modifier is
    /// blacklisted and the format renegotiated.
    #[allow(clippy::too_many_arguments)]
    fn convert_dmabuf(
        &mut self,
        stream: &Stream,
        format: NegotiatedFormat,
        datas: &[Data],
        crop: Rect,
        out_width: u32,
        out_height: u32,
        out: &mut Vec<u8>,
    ) -> Result<bool, String> {
        let gpu = self.gpu.as_mut().ok_or("DMA-BUF received without GPU converter")?;
        let planes = dmabuf_planes(datas);
        let modifier = format.modifier.unwrap_or(DRM_FORMAT_MOD_INVALID);
        let frame = DmaBufFrame { width: format.width, height: format.height, format: format.pixel, modifier, planes: &planes, crop };
        match gpu.convert_dmabuf(&frame, out_width, out_height, out) {
            Ok(()) => Ok(true),
            Err(error) => {
                eprintln!("[screencast] DMA-BUF import failed for modifier 0x{modifier:x}, renegotiating: {error}");
                self.blacklist.insert(modifier);
                self.renegotiate(stream);
                Ok(false)
            }
        }
    }

    /// Offers the formats again without blacklisted modifiers.
    fn renegotiate(&self, stream: &Stream) {
        let enum_formats =
            build_enum_formats(self.settings.fps, &|format| supported_modifiers(self.gpu.as_ref(), format), &self.blacklist);
        match pods(&enum_formats) {
            Ok(mut params) => {
                if let Err(error) = stream.update_params(&mut params) {
                    eprintln!("[screencast] renegotiation failed: {error}");
                }
            }
            Err(error) => eprintln!("[screencast] {error}"),
        }
    }
}

impl Drop for State {
    /// Logs how often explicit sync kept a frame from being read too early.
    fn drop(&mut self) {
        if self.synced_frames > 0 {
            eprintln!(
                "[screencast] explicit sync: {} of {} frames arrived before the compositor finished writing them",
                self.early_frames, self.synced_frames
            );
        }
    }
}

/// Converts a shared-memory buffer on the CPU.
fn convert_shm(format: NegotiatedFormat, data: &mut Data, crop: Rect, out_width: u32, out_height: u32, out: &mut Vec<u8>) -> Result<bool, String> {
    let chunk = data.chunk();
    let (offset, size) = (chunk.offset() as usize, chunk.size() as usize);
    let stride = match chunk.stride() {
        stride if stride > 0 => stride as usize,
        _ => format.width as usize * BYTES_PER_PIXEL,
    };
    if size == 0 {
        return Ok(false);
    }
    let bytes = data.data().ok_or("shared-memory buffer is not mapped")?;
    let end = (offset + size).min(bytes.len());
    cpu::convert_to_i420(&bytes[offset..end], stride, format.pixel, crop, out_width, out_height, out)?;
    Ok(true)
}

/// Turns a valid `VideoCrop` meta region into a rectangle.
fn crop_from_meta(meta: &MetaVideoCrop) -> Option<Rect> {
    let region = meta.meta_region();
    if !region.is_valid() {
        return None;
    }
    let (position, size) = (region.position(), region.size());
    Some(Rect { x: position.x.max(0) as u32, y: position.y.max(0) as u32, width: size.width, height: size.height })
}

/// Whether a negotiated format pod carries a DRM modifier.
fn has_modifier(param: &Pod) -> bool {
    match PodDeserializer::deserialize_any_from(param.as_bytes()) {
        Ok((_, Value::Object(object))) => object.properties.iter().any(|p| p.key == sys::SPA_FORMAT_VIDEO_modifier),
        _ => false,
    }
}

/// Builds the `EnumFormat` pods: per pixel format a DMA-BUF variant with the
/// usable modifiers (if any) followed by a shared-memory variant.
pub fn build_enum_formats(fps: u32, modifiers: &dyn Fn(PixelFormat) -> Vec<u64>, blacklist: &HashSet<u64>) -> Vec<Vec<u8>> {
    let mut formats = Vec::new();
    for format in PixelFormat::ALL {
        let usable: Vec<i64> = modifiers(format).into_iter().filter(|m| !blacklist.contains(m)).map(|m| m as i64).collect();
        if let Some(&default) = usable.first() {
            let mut properties = base_format_properties(format, fps);
            properties.push(Property {
                key: sys::SPA_FORMAT_VIDEO_modifier,
                flags: PropertyFlags::MANDATORY | PropertyFlags::from_bits_retain(sys::SPA_POD_PROP_FLAG_DONT_FIXATE),
                value: Value::Choice(ChoiceValue::Long(Choice(ChoiceFlags::empty(), ChoiceEnum::Enum { default, alternatives: usable }))),
            });
            formats.push(serialize(object(SpaTypes::ObjectParamFormat, ParamType::EnumFormat, properties)));
        }
        formats.push(serialize(object(SpaTypes::ObjectParamFormat, ParamType::EnumFormat, base_format_properties(format, fps))));
    }
    formats
}

/// Format properties shared by the DMA-BUF and shared-memory variants.
fn base_format_properties(format: PixelFormat, fps: u32) -> Vec<Property> {
    vec![
        Property::new(sys::SPA_FORMAT_mediaType, Value::Id(Id(MediaType::Video.as_raw()))),
        Property::new(sys::SPA_FORMAT_mediaSubtype, Value::Id(Id(MediaSubtype::Raw.as_raw()))),
        Property::new(sys::SPA_FORMAT_VIDEO_format, Value::Id(Id(format.spa().as_raw()))),
        Property::new(
            sys::SPA_FORMAT_VIDEO_size,
            Value::Choice(ChoiceValue::Rectangle(Choice(
                ChoiceFlags::empty(),
                ChoiceEnum::Range {
                    default: Rectangle { width: 1920, height: 1080 },
                    min: Rectangle { width: 1, height: 1 },
                    max: Rectangle { width: MAX_DIMENSION, height: MAX_DIMENSION },
                },
            ))),
        ),
        Property::new(sys::SPA_FORMAT_VIDEO_framerate, Value::Fraction(Fraction { num: 0, denom: 1 })),
        Property::new(
            sys::SPA_FORMAT_VIDEO_maxFramerate,
            Value::Choice(ChoiceValue::Fraction(Choice(
                ChoiceFlags::empty(),
                ChoiceEnum::Range {
                    default: Fraction { num: fps, denom: 1 },
                    min: Fraction { num: 1, denom: 1 },
                    max: Fraction { num: fps, denom: 1 },
                },
            ))),
        ),
    ]
}

/// Whether a buffer carries a picture: producers queue buffers with an empty
/// or corrupted chunk when only metadata changed or recording failed.
fn has_content(header_corrupted: bool, chunk_flags: ChunkFlags, chunk_size: u32) -> bool {
    !header_corrupted && !chunk_flags.contains(ChunkFlags::CORRUPTED) && chunk_size > 0
}

/// [`has_content`] for a dequeued buffer.
fn buffer_has_content(buffer: &mut Buffer) -> bool {
    let header_corrupted = buffer.find_meta::<MetaHeader>().is_some_and(|header| header.flags().contains(MetaHeaderFlags::CORRUPTED));
    buffer.datas_mut().first().is_some_and(|first| has_content(header_corrupted, first.chunk().flags(), first.chunk().size()))
}

/// The image planes of a DMA-BUF buffer, without the syncobjs that explicit
/// sync appends.
fn dmabuf_planes(datas: &[Data]) -> Vec<DmaBufPlane> {
    datas
        .iter()
        .filter(|data| data.type_() == DataType::DmaBuf)
        .map(|data| DmaBufPlane { fd: data.fd(), offset: data.chunk().offset(), stride: data.chunk().stride() as u32 })
        .collect()
}

/// Explicit-sync points of a buffer with `SyncTimeline` metadata; its acquire
/// and release syncobjs are the last two datas, after at least one plane.
fn sync_points(points: Option<(u64, u64)>, datas: &[Data]) -> Option<SyncPoints> {
    let (acquire_point, release_point) = points?;
    let [_, .., acquire, release] = datas else { return None };
    Some(SyncPoints { acquire_fd: acquire.fd(), acquire_point, release_fd: release.fd(), release_point })
}

/// `Buffers` and `Meta` params for the negotiated memory type. With explicit
/// sync, DMA-BUF streams also request `SyncTimeline`, so the producer adds
/// acquire and release syncobjs to each buffer.
fn buffer_params(dmabuf: bool, explicit_sync: bool) -> Vec<Vec<u8>> {
    let data_types = if dmabuf {
        1 << DataType::DmaBuf.as_raw() | 1 << DataType::MemFd.as_raw()
    } else {
        1 << DataType::MemFd.as_raw() | 1 << DataType::MemPtr.as_raw()
    };
    let buffers = || {
        vec![
            Property::new(
                sys::SPA_PARAM_BUFFERS_buffers,
                Value::Choice(ChoiceValue::Int(Choice(ChoiceFlags::empty(), ChoiceEnum::Range { default: 8, min: 1, max: 32 }))),
            ),
            Property::new(
                sys::SPA_PARAM_BUFFERS_dataType,
                Value::Choice(ChoiceValue::Int(Choice(ChoiceFlags::empty(), ChoiceEnum::Flags { default: data_types as i32, flags: Vec::new() }))),
            ),
        ]
    };
    let meta = |kind: u32, size: usize| {
        serialize(object(
            SpaTypes::ObjectParamMeta,
            ParamType::Meta,
            vec![
                Property::new(sys::SPA_PARAM_META_type, Value::Id(Id(kind))),
                Property::new(sys::SPA_PARAM_META_size, Value::Int(size as i32)),
            ],
        ))
    };
    let mut params = Vec::new();
    if dmabuf && explicit_sync {
        let mut synced = buffers();
        synced.push(Property {
            key: sys::SPA_PARAM_BUFFERS_metaType,
            flags: PropertyFlags::MANDATORY,
            value: Value::Int(1 << sys::SPA_META_SyncTimeline),
        });
        params.push(serialize(object(SpaTypes::ObjectParamBuffers, ParamType::Buffers, synced)));
    }
    params.extend([
        serialize(object(SpaTypes::ObjectParamBuffers, ParamType::Buffers, buffers())),
        meta(sys::SPA_META_Header, std::mem::size_of::<sys::spa_meta_header>()),
        meta(sys::SPA_META_VideoCrop, std::mem::size_of::<sys::spa_meta_region>()),
    ]);
    if dmabuf && explicit_sync {
        params.push(meta(sys::SPA_META_SyncTimeline, std::mem::size_of::<sys::spa_meta_sync_timeline>()));
    }
    params
}

/// Creates a pod object of the given type and id.
fn object(type_: SpaTypes, id: ParamType, properties: Vec<Property>) -> Object {
    Object { type_: type_.as_raw(), id: id.as_raw(), properties }
}

/// Serializes a pod object into bytes.
fn serialize(object: Object) -> Vec<u8> {
    PodSerializer::serialize(Cursor::new(Vec::new()), &Value::Object(object))
        .expect("serializing a pod into memory cannot fail")
        .0
        .into_inner()
}

/// Borrows serialized pods as `Pod` references for PipeWire calls.
fn pods(bytes: &[Vec<u8>]) -> Result<Vec<&Pod>, String> {
    bytes.iter().map(|b| Pod::from_bytes(b).ok_or_else(|| "invalid pod".to_string())).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::formats::PixelFormat;
    use pipewire::spa::pod::deserialize::PodDeserializer;
    use pipewire::spa::pod::{ChoiceValue, Object, Value};
    use pipewire::spa::sys;
    use pipewire::spa::utils::{ChoiceEnum, Fraction};
    use std::collections::HashSet;

    fn parse(bytes: &[u8]) -> Object {
        match PodDeserializer::deserialize_any_from(bytes).unwrap().1 {
            Value::Object(object) => object,
            other => panic!("expected object, got {other:?}"),
        }
    }

    fn property(object: &Object, key: u32) -> Option<&Value> {
        object.properties.iter().find(|p| p.key == key).map(|p| &p.value)
    }

    fn modifier_values(object: &Object) -> Option<Vec<i64>> {
        match property(object, sys::SPA_FORMAT_VIDEO_modifier)? {
            Value::Choice(ChoiceValue::Long(choice)) => match &choice.1 {
                ChoiceEnum::Enum { default, alternatives } => {
                    Some(std::iter::once(*default).chain(alternatives.iter().copied()).collect())
                }
                other => panic!("unexpected modifier choice {other:?}"),
            },
            other => panic!("unexpected modifier value {other:?}"),
        }
    }

    fn two_modifiers(_: PixelFormat) -> Vec<u64> {
        vec![1, 2]
    }

    #[test]
    fn enum_formats_with_and_without_modifiers() {
        let pods = build_enum_formats(60, &two_modifiers, &HashSet::new());
        assert_eq!(pods.len(), 8);
        let first = parse(&pods[0]);
        assert_eq!(property(&first, sys::SPA_FORMAT_VIDEO_format), Some(&Value::Id(pipewire::spa::utils::Id(PixelFormat::ALL[0].spa().as_raw()))));
        assert_eq!(modifier_values(&first), Some(vec![1, 1, 2]));
        match property(&first, sys::SPA_FORMAT_VIDEO_maxFramerate) {
            Some(Value::Choice(ChoiceValue::Fraction(choice))) => match &choice.1 {
                ChoiceEnum::Range { max, .. } => assert_eq!(*max, Fraction { num: 60, denom: 1 }),
                other => panic!("unexpected framerate choice {other:?}"),
            },
            other => panic!("unexpected framerate value {other:?}"),
        }
        assert_eq!(modifier_values(&parse(&pods[1])), None);
    }

    #[test]
    fn blacklisted_modifier_removed() {
        let pods = build_enum_formats(30, &two_modifiers, &HashSet::from([1]));
        assert_eq!(pods.len(), 8);
        assert_eq!(modifier_values(&parse(&pods[0])), Some(vec![2, 2]));
        let pods = build_enum_formats(30, &two_modifiers, &HashSet::from([1, 2]));
        assert_eq!(pods.len(), 4);
        assert!(pods.iter().all(|pod| modifier_values(&parse(pod)).is_none()));
    }

    #[test]
    fn no_modifiers_offers_shm_only() {
        let pods = build_enum_formats(30, &|_| Vec::new(), &HashSet::new());
        assert_eq!(pods.len(), 4);
    }

    fn requests_sync_timeline(pods: &[Vec<u8>]) -> bool {
        pods.iter().map(|pod| parse(pod)).filter(|object| object.id == ParamType::Meta.as_raw()).any(|object| {
            property(&object, sys::SPA_PARAM_META_type) == Some(&Value::Id(Id(sys::SPA_META_SyncTimeline)))
                && property(&object, sys::SPA_PARAM_META_size) == Some(&Value::Int(24))
        })
    }

    #[test]
    fn sync_timeline_requested_only_for_dmabuf_with_explicit_sync() {
        assert!(requests_sync_timeline(&buffer_params(true, true)));
        assert!(!requests_sync_timeline(&buffer_params(true, false)));
        assert!(!requests_sync_timeline(&buffer_params(false, true)));
    }

    fn buffers_params(pods: &[Vec<u8>]) -> Vec<Object> {
        pods.iter().map(|pod| parse(pod)).filter(|object| object.id == ParamType::Buffers.as_raw()).collect()
    }

    fn mandatory_meta_type(object: &Object) -> Option<i32> {
        object.properties.iter().find(|p| p.key == sys::SPA_PARAM_BUFFERS_metaType).map(|p| {
            assert!(p.flags.contains(PropertyFlags::MANDATORY), "metaType must be mandatory");
            match p.value {
                Value::Int(types) => types,
                ref other => panic!("unexpected metaType {other:?}"),
            }
        })
    }

    #[test]
    fn explicit_sync_buffers_layout_is_offered_first() {
        let buffers = buffers_params(&buffer_params(true, true));
        assert_eq!(buffers.len(), 2);
        assert_eq!(mandatory_meta_type(&buffers[0]), Some(1 << sys::SPA_META_SyncTimeline));
        assert_eq!(mandatory_meta_type(&buffers[1]), None);
        for params in [buffer_params(true, false), buffer_params(false, true)] {
            let buffers = buffers_params(&params);
            assert_eq!(buffers.len(), 1);
            assert_eq!(mandatory_meta_type(&buffers[0]), None);
        }
    }

    #[test]
    fn empty_or_corrupted_buffers_have_no_picture() {
        assert!(has_content(false, ChunkFlags::empty(), 4096));
        assert!(!has_content(false, ChunkFlags::empty(), 0));
        assert!(!has_content(false, ChunkFlags::CORRUPTED, 4096));
        assert!(!has_content(true, ChunkFlags::empty(), 4096));
    }

    fn chunk(stride: i32) -> sys::spa_chunk {
        sys::spa_chunk { offset: 0, size: 0, stride, flags: 0 }
    }

    fn raw_data(type_: u32, fd: i64, chunk: &mut sys::spa_chunk) -> sys::spa_data {
        sys::spa_data { type_, flags: 0, fd, mapoffset: 0, maxsize: 0, data: std::ptr::null_mut(), chunk }
    }

    fn as_datas(raw: &mut [sys::spa_data]) -> &[Data] {
        unsafe { std::slice::from_raw_parts(raw.as_ptr().cast::<Data>(), raw.len()) }
    }

    #[test]
    fn sync_objects_are_not_image_planes() {
        let mut chunks = [chunk(7680), chunk(0), chunk(0)];
        let [image, acquire, release] = &mut chunks;
        let mut raw = [
            raw_data(sys::SPA_DATA_DmaBuf, 10, image),
            raw_data(sys::SPA_DATA_SyncObj, 11, acquire),
            raw_data(sys::SPA_DATA_SyncObj, 12, release),
        ];
        let planes = dmabuf_planes(as_datas(&mut raw));
        assert_eq!(planes.len(), 1);
        assert_eq!((planes[0].fd, planes[0].offset, planes[0].stride), (10, 0, 7680));
    }

    #[test]
    fn sync_points_come_from_the_last_two_datas() {
        let mut chunks = [chunk(7680), chunk(0), chunk(0)];
        let [image, acquire, release] = &mut chunks;
        let mut raw = [
            raw_data(sys::SPA_DATA_DmaBuf, 10, image),
            raw_data(sys::SPA_DATA_SyncObj, 11, acquire),
            raw_data(sys::SPA_DATA_SyncObj, 12, release),
        ];
        let expected = SyncPoints { acquire_fd: 11, acquire_point: 5, release_fd: 12, release_point: 6 };
        assert_eq!(sync_points(Some((5, 6)), as_datas(&mut raw)), Some(expected));
        assert_eq!(sync_points(None, as_datas(&mut raw)), None);
        assert_eq!(sync_points(Some((5, 6)), &as_datas(&mut raw)[..1]), None);
    }
}
