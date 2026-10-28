# Wayland Screen Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture screens/windows on Linux Wayland through the ScreenCast portal with an embedded cursor, convert frames natively (GPU first, CPU fallback) and feed them into the existing mediasoup screen producer, with a new 30/60 fps option.

**Architecture:** A Rust workspace in `native/screencast` (core library + napi-rs binding) runs inside an Electron utility process started by the main process. Frames travel as I420 buffers over a `MessageChannelMain` port to the renderer, which writes them into a `MediaStreamTrackGenerator` that `screen.js` produces like today's track. `getDisplayMedia` stays as the fallback and for other platforms.

**Tech Stack:** Rust (ashpd 0.13 with `async-io`, pipewire 0.10, khronos-egl 6 `dynamic`, glow 0.18, libloading 0.9, fast_image_resize 6, yuvutils-rs 0.8, napi 3 / napi-derive 3), Electron 43.2.0 utility process, `MediaStreamTrackGenerator`, mediasoup-client, `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-28-wayland-screencast-design.md`

## Global Constraints

- Portal request: `cursor_mode = Embedded`, `types = Monitor | Window`, `multiple = false`, `persist_mode = DoNot`.
- Output: I420, BT.601 limited range, width a multiple of 8, height a multiple of 2, aspect ratio kept, never upscaled.
- Error messages from `start` begin with `cancelled:`, `unsupported:` or `error:`.
- Frame rates: 30 and 60 fps only. Resolution presets: 720, 1080, 1440, 2160.
- Bitrates (bps): 720 → 2_500_000 / 4_000_000, 1080 → 5_000_000 / 8_000_000, 1440 → 8_000_000 / 12_000_000, 2160 → 14_000_000 / 20_000_000 (30 / 60 fps). Start bitrate kbps = min(maxBitrate / 2000, 3000).
- `contentHint = 'motion'` on the shared video track.
- Keepalive: repeat the last frame after 500 ms without a new frame.
- Flow control: at most 2 frames in flight between utility process and renderer.
- `GIMODI_SCREEN_CAPTURE=legacy` disables the portal path; `GIMODI_SCREENCAST_NO_GPU=1` forces the CPU path (diagnostics).
- Runtime-loaded libraries: `libEGL.so.1`, `libgbm.so.1`. Linked: `libpipewire-0.3.so.0`. No new runtime dependency in the .deb.
- JS: JSDoc on every function, no inline comments, English only. Commits: Conventional Commits, no AI attribution.
- Native code never runs in the main or renderer process.

## Review Focus

1. GNOME window streams carry monitor-sized buffers plus `VideoCrop`; the shared picture must show only the window. Pinned by crop tests in Tasks 1, 2 and 3.
2. Window resize or monitor mode change renegotiates the stream; conversion must follow the new size without crashing and the renderer must accept frames of a new size. Pinned by size-change tests in Tasks 2 and 3 and the renderer handling in Task 8.
3. Stopping via the GNOME sharing indicator (portal session closed) or a crashing worker must end the share in gimodi and leave no utility process behind. Pinned by the controller test in Task 7 and the integration check in Task 10.
4. A DMA-BUF import failure must fall back to shm without the user noticing. Pinned by the modifier blacklist test in Task 4 and the `GIMODI_SCREENCAST_NO_GPU=1` run in Task 10.
5. Cancelling the portal dialog must not show an error or trigger the `getDisplayMedia` fallback. Pinned by the error-mapping test in Task 5 and the classification test in Task 8.

---

### Task 1: Rust workspace, geometry and pixel formats

**Files:**
- Create: `native/screencast/Cargo.toml` (workspace: members `core`, `node`; `[profile.release]` `lto = "thin"`)
- Create: `native/screencast/core/Cargo.toml` (crate `gimodi-screencast-core`, edition 2021, all core dependencies from the tech stack; ashpd with `default-features = false, features = ["async-io", "screencast"]`)
- Create: `native/screencast/core/src/lib.rs`, `geometry.rs`, `formats.rs`
- Create: `native/screencast/node/Cargo.toml` (crate `gimodi-screencast`, `crate-type = ["cdylib"]`), `node/build.rs`, `node/src/lib.rs` (empty module for now)
- Modify: `.gitignore` (add `native/screencast/target/` and `native/screencast/*.node`)

**Interfaces:**
- Produces:
  - `geometry::Rect { x: u32, y: u32, width: u32, height: u32 }` (Copy, Debug, PartialEq)
  - `geometry::crop_rect(stream_width: u32, stream_height: u32, crop: Option<Rect>) -> Rect`: the crop if it is non-empty and inside the stream, else the full stream.
  - `geometry::fit_output_size(src_width: u32, src_height: u32, max_width: u32, max_height: u32) -> (u32, u32)`
  - `formats::PixelFormat { Bgra, Bgrx, Rgba, Rgbx }` with `ALL: [PixelFormat; 4]`, `from_spa(spa_sys::spa_video_format) -> Option<Self>`, `spa(self) -> spa::param::video::VideoFormat`, `drm_fourcc(self) -> u32`, `red_first(self) -> bool`.

- [ ] **Step 1: Write the failing tests** in `geometry.rs` / `formats.rs` (`#[cfg(test)]`):

```rust
assert_eq!(fit_output_size(2560, 1440, 1920, 1080), (1920, 1080));
assert_eq!(fit_output_size(1280, 720, 1920, 1080), (1280, 720));   // never upscale
assert_eq!(fit_output_size(1003, 701, 1920, 1080), (1000, 700));   // width % 8, height % 2
assert_eq!(fit_output_size(3440, 1440, 1920, 1080), (1920, 802));  // ultrawide fits width
assert_eq!(fit_output_size(7, 7, 1920, 1080), (8, 8));             // minimum 8x8, never 0
assert_eq!(crop_rect(2560, 1440, Some(Rect { x: 100, y: 50, width: 800, height: 600 })), Rect { x: 100, y: 50, width: 800, height: 600 });
assert_eq!(crop_rect(2560, 1440, Some(Rect { x: 0, y: 0, width: 0, height: 0 })), Rect { x: 0, y: 0, width: 2560, height: 1440 });
assert_eq!(crop_rect(2560, 1440, Some(Rect { x: 2000, y: 0, width: 800, height: 600 })), Rect { x: 0, y: 0, width: 2560, height: 1440 });
assert_eq!(PixelFormat::Bgra.drm_fourcc(), 0x3432_5241); // 'AR24'
assert_eq!(PixelFormat::Bgrx.drm_fourcc(), 0x3432_5258); // 'XR24'
assert_eq!(PixelFormat::Rgba.drm_fourcc(), 0x3432_4241); // 'AB24'
assert_eq!(PixelFormat::Rgbx.drm_fourcc(), 0x3432_4258); // 'XB24'
assert_eq!(PixelFormat::from_spa(spa_sys::SPA_VIDEO_FORMAT_BGRx), Some(PixelFormat::Bgrx));
```

- [ ] **Step 2: Run** `cargo test -p gimodi-screencast-core` → FAIL (functions missing). Build needs `PKG_CONFIG_PATH` pointing at `libpipewire-0.3`/`libspa-0.2` dev files.
- [ ] **Step 3: Implement** `geometry.rs` and `formats.rs` (scale by `min(max_w/src_w, max_h/src_h, 1)`, floor width to multiple of 8, height to multiple of 2, clamp to at least 8x8 (minimum is 8 in both directions)).
- [ ] **Step 4: Run** `cargo test -p gimodi-screencast-core` → PASS.
- [ ] **Step 5: Commit** `feat(screencast): add native workspace with geometry and formats`

### Task 2: CPU conversion (shm fallback)

**Files:**
- Create: `native/screencast/core/src/cpu.rs`

**Interfaces:**
- Consumes: `Rect`, `PixelFormat`.
- Produces: `cpu::convert_to_i420(src: &[u8], stride: usize, format: PixelFormat, crop: Rect, out_width: u32, out_height: u32, out: &mut Vec<u8>) -> Result<(), String>`; `out` is resized to `w*h*3/2`.

- [ ] **Step 1: Write the failing tests:** solid colours (crop = whole 64x32 image, output 64x32): white → Y 235, U 128, V 128; black → Y 16, U 128, V 128; red (R=255) → Y 82±1, U 90±1, V 240±1; for `Bgrx` and `Rgbx` sources. Crop test: 64x32 black image with a white 16x16 square at (32,8), crop `{32,8,16,16}` → every Y = 235. Size-change test: two calls with 64x32 then 128x64 outputs both produce correctly sized buffers.
- [ ] **Step 2: Run** `cargo test -p gimodi-screencast-core cpu` → FAIL.
- [ ] **Step 3: Implement:** crop view → `fast_image_resize` (U8x4, bilinear) into an RGBA scratch buffer of the output size → `yuvutils-rs` `bgra_to_yuv420`/`rgba_to_yuv420` with `YuvRange::Limited`, `YuvStandardMatrix::Bt601` into the three planes of `out`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(screencast): add cpu i420 conversion`

### Task 3: GPU conversion (EGL/GBM, GLES 3)

**Files:**
- Create: `native/screencast/core/src/gpu/mod.rs`, `gpu/egl.rs`, `gpu/shaders.rs`

**Interfaces:**
- Consumes: `Rect`, `PixelFormat`.
- Produces:
  - `gpu::DmaBufPlane { fd: RawFd, offset: u32, stride: u32 }`
  - `gpu::DmaBufFrame<'a> { width: u32, height: u32, format: PixelFormat, modifier: u64, planes: &'a [DmaBufPlane], crop: Rect }`
  - `gpu::GpuConverter::new() -> Result<GpuConverter, String>` (must be called on the thread that converts)
  - `GpuConverter::modifiers(&self, format: PixelFormat) -> Vec<u64>`
  - `GpuConverter::convert_dmabuf(&mut self, frame: &DmaBufFrame, out_width: u32, out_height: u32, out: &mut Vec<u8>) -> Result<(), String>`
  - test-only `GpuConverter::convert_rgba(&mut self, rgba: &[u8], width: u32, height: u32, crop: Rect, out_width: u32, out_height: u32, out: &mut Vec<u8>) -> Result<(), String>` (uploads into a `GL_TEXTURE_2D`, same passes)

Approach: load `libgbm.so.1` with libloading (`gbm_create_device`, `gbm_device_destroy`, plus `gbm_bo_create_with_modifiers`, `gbm_bo_get_fd`, `gbm_bo_get_stride`, `gbm_bo_map`, `gbm_bo_unmap`, `gbm_bo_destroy` for tests); open the first `/dev/dri/renderD*`; `eglGetPlatformDisplay(EGL_PLATFORM_GBM_KHR)`; GLES 3 context, surfaceless; require `EGL_EXT_image_dma_buf_import(_modifiers)` and `GL_OES_EGL_image_external_essl3`. Shaders exist in an external-OES and a 2D variant. Three passes into RGBA8 FBOs (Y `W/4 x H`, U and V `W/8 x H/2`), each texel packs 4 samples; BT.601 limited coefficients; chroma samples at the centre of each 2x2 block; `glReadPixels(RGBA, UNSIGNED_BYTE)` into the plane offsets of `out`.

- [ ] **Step 1: Write the failing tests** (skip with a printed note when `GpuConverter::new()` fails, so machines without a GPU pass):
  - `gpu_matches_cpu_reference`: horizontal+vertical gradient 256x128 RGBA, no scaling → every output byte within ±2 of `cpu::convert_to_i420` on the same image.
  - `gpu_scales_and_crops`: 512x256 gradient, crop `{64,32,256,128}`, output 128x64 → within ±3 of the CPU result for the same crop and size.
  - `gpu_handles_size_change`: two conversions with different output sizes in a row both succeed with correct lengths.
  - `gpu_imports_dmabuf`: create a GBM BO (ARGB8888, linear modifier or `DRM_FORMAT_MOD_INVALID`), fill it via `gbm_bo_map` with the gradient, import via `convert_dmabuf` → within ±2 of the CPU result.
  - `modifiers_listed`: `modifiers(PixelFormat::Bgrx)` is non-empty when the GPU path initialised.
- [ ] **Step 2: Run** `cargo test -p gimodi-screencast-core gpu -- --nocapture` → FAIL.
- [ ] **Step 3: Implement** `egl.rs` (loading, display, context, extension checks, modifier query, `create_dmabuf_image`), `shaders.rs`, `mod.rs` (FBO/texture management per output size, passes, readback).
- [ ] **Step 4: Run** → PASS on this machine (NVIDIA).
- [ ] **Step 5: Commit** `feat(screencast): add gpu i420 conversion with dma-buf import`

### Task 4: PipeWire stream consumer

**Files:**
- Create: `native/screencast/core/src/stream.rs`
- Create: `native/screencast/core/tests/mutter_stream.rs` (`#[ignore]` integration test)

**Interfaces:**
- Consumes: Tasks 1-3.
- Produces:
  - `stream::Frame { width: u32, height: u32, data: Vec<u8> }` (I420)
  - `stream::StreamSettings { max_width: u32, max_height: u32, fps: u32, use_gpu: bool }`
  - `stream::Remote { Fd(OwnedFd), Default }`
  - `stream::StopHandle` (Clone, Send) with `stop(&self)`; `stream::stop_pair() -> (StopHandle, StopReceiver)`
  - `stream::run_stream(remote: Remote, node_id: u32, settings: StreamSettings, on_frame: Box<dyn FnMut(Frame) + Send>, stop: StopReceiver) -> Result<StreamEnd, String>` — blocks until stopped or the stream ends; `StreamEnd { Stopped, Ended(String) }`.
  - `stream::build_enum_formats(fps: u32, modifiers: &dyn Fn(PixelFormat) -> Vec<u64>, blacklist: &HashSet<u64>) -> Vec<Vec<u8>>` (serialized pods)

Behaviour: formats per `PixelFormat::ALL`, each with a modifier variant (`MANDATORY | DONT_FIXATE`, first modifier repeated as default, blacklisted modifiers removed, variant omitted when empty) followed by the shm variant; `framerate 0/1`, `maxFramerate` range `fps/1` default, `1/1` min, `fps/1` max; size range 1x1..8192x8192. On `Format`: parse `VideoInfoRaw`, note modifier presence, `update_params` with Buffers (`DmaBuf` when modifier else `MemFd | MemPtr`) and Meta (`Header`, `VideoCrop`). `process`: drain to the newest buffer; skip `MetaHeader` corrupted flag and chunks flagged corrupted or with size 0 (shm); crop from `MetaVideoCrop` through `crop_rect`; output size `fit_output_size(crop...)`; DMA-BUF → GPU (create `GpuConverter` lazily on this thread, disabled when `use_gpu` is false or init fails); shm → CPU. On GPU import failure: add the modifier to the blacklist and `update_params` with fresh EnumFormats; when the GPU path is disabled, only shm variants are offered. Stream state `Error` or `Unconnected` after streaming → `StreamEnd::Ended`.

- [ ] **Step 1: Write the failing tests:**
  - `enum_formats_with_and_without_modifiers`: with modifiers `[1, 2]` for all formats and empty blacklist → 8 pods; parsing the first pod shows format BGRA, a modifier choice with values `[1, 1, 2]`, `maxFramerate` max `60/1` for fps 60; the second pod has no modifier property.
  - `blacklisted_modifier_removed`: blacklist `{1}` → modifier choice values `[2, 2]`; blacklist `{1, 2}` → 4 pods, none with modifiers.
  - `mutter_stream_delivers_frames` (`#[ignore]`): create a session through `org.gnome.Mutter.ScreenCast` (zbus, `RecordMonitor` on the first connector from `org.gnome.Mutter.DisplayConfig.GetCurrentState`, `cursor-mode` 1), run `run_stream(Remote::Default, node, {1920,1080,30,true})` for 3 s while an animation runs → ≥ 30 frames, each `data.len() == w*h*3/2`; same with `use_gpu: false` → ≥ 10 frames.
- [ ] **Step 2: Run** `cargo test -p gimodi-screencast-core stream` → FAIL.
- [ ] **Step 3: Implement** `stream.rs` (MainLoop on the calling thread, stop via `pipewire::channel`).
- [ ] **Step 4: Run** unit tests → PASS; run `cargo test -p gimodi-screencast-core --test mutter_stream -- --ignored --nocapture` with an animation window open → PASS.
- [ ] **Step 5: Commit** `feat(screencast): add pipewire stream consumer`

### Task 5: Portal session and capture orchestration

**Files:**
- Create: `native/screencast/core/src/portal.rs`, `native/screencast/core/src/capture.rs`
- Modify: `native/screencast/core/src/lib.rs` (re-exports)

**Interfaces:**
- Consumes: `run_stream`, `StopHandle`, `Frame`, `StreamSettings`.
- Produces:
  - `capture::CaptureOptions { max_width: u32, max_height: u32, fps: u32 }`
  - `capture::StartedInfo { width: u32, height: u32, source_type: String }` (`"monitor"`, `"window"` or `"unknown"`; size 0x0 when the portal did not report it)
  - `capture::CaptureEvent { Ended(String), Error(String) }`
  - `capture::StartError { Cancelled, Unsupported(String), Failed(String) }` with `Display` → `cancelled: …`, `unsupported: …`, `error: …`
  - `capture::Capture::start(options, on_frame: Box<dyn FnMut(Frame) + Send>, on_event: Box<dyn Fn(CaptureEvent) + Send + Sync>) -> Result<(Capture, StartedInfo), StartError>` (blocks until the portal finished)
  - `Capture::stop(&mut self)` (idempotent, joins threads, closes the session)
  - `portal::map_error(err: &ashpd::Error) -> StartError`

Behaviour: portal thread uses `futures_lite::future::block_on`; checks `available_cursor_modes()` contains `Embedded` (else `Unsupported`); `create_session`, `select_sources`, `start(None)`, first stream, `open_pipe_wire_remote`. After success it waits for `receive_closed()` or a stop signal (async channel), then `session.close()`. Closed by the portal → stop the stream and emit `Ended("portal session closed")`. PipeWire thread runs `run_stream(Remote::Fd, …)`; `StreamEnd::Ended(reason)` → `Ended(reason)`; `use_gpu = std::env::var("GIMODI_SCREENCAST_NO_GPU").is_err()`.

- [ ] **Step 1: Write the failing tests:** `map_error` maps `Error::Response(ResponseError::Cancelled)` to `Cancelled`, `Error::PortalNotFound(..)` to `Unsupported(..)` and `Error::Response(ResponseError::Other)` to `Failed(..)`; `StartError::Cancelled.to_string()` starts with `cancelled:`.
- [ ] **Step 2: Run** `cargo test -p gimodi-screencast-core portal` → FAIL.
- [ ] **Step 3: Implement** `portal.rs` and `capture.rs`.
- [ ] **Step 4: Run** `cargo test -p gimodi-screencast-core` → PASS.
- [ ] **Step 5: Commit** `feat(screencast): add portal session and capture orchestration`

### Task 6: Node binding, build script and packaging

**Files:**
- Modify: `native/screencast/node/src/lib.rs`, `native/screencast/node/build.rs`
- Create: `native/screencast/index.js` (CommonJS loader exporting `require('./screencast.node')`)
- Create: `scripts/build-native.js`
- Modify: `package.json` (scripts), `forge.config.js` (ignore + asar unpack), `README.md` (build requirements)
- Test: `test/native-screencast.test.js`

**Interfaces:**
- Consumes: `Capture`, `CaptureOptions`, `StartedInfo`, `CaptureEvent`, `StartError`.
- Produces (JS): `new ScreenCapture()`; `start(options: { maxWidth, maxHeight, fps }, onFrame: (frame: { data: Buffer, width: number, height: number }) => void, onEvent: (event: { type: 'ended'|'error', message: string }) => void): Promise<{ width: number, height: number, sourceType: string }>`; `stop(): void`.
- Produces (npm): `npm run build:native`; `npm test` (`node --test test/`).

Binding details: `onFrame` as a `ThreadsafeFunction` with max queue size 1 called `NonBlocking` (QueueFull → frame dropped); `start` returns a promise resolved from the capture thread through a deferred; `stop` and drop are idempotent. `build-native.js`: no-op with a message on non-Linux or when `cargo` is missing; otherwise `cargo build --release --manifest-path native/screencast/Cargo.toml -p gimodi-screencast` and copy `native/screencast/target/release/libgimodi_screencast.so` to `native/screencast/screencast.node`. `package.json`: `build:native`, `test`; `start`, `package`, `make` and all `deploy:linux:*` run `build:native` after `build`. `forge.config.js`: ignore `^/native/screencast/(core|node|target)/` and `^/native/screencast/Cargo\.(toml|lock)$`; `asar.unpack: '**/*.node'`.

- [ ] **Step 1: Write the failing test** `test/native-screencast.test.js` (skipped unless `process.platform === 'linux'` and the `.node` exists): the module exports `ScreenCapture`; `new ScreenCapture().stop()` twice does not throw; `start` with `{ maxWidth: 0, maxHeight: 1080, fps: 30 }` rejects with a message starting with `error:` (invalid options, validated before the portal).
- [ ] **Step 2: Run** `npm run build:native && npm test` → FAIL.
- [ ] **Step 3: Implement** binding, loader, build script, scripts and packaging config.
- [ ] **Step 4: Run** `npm run build:native && npm test` → PASS.
- [ ] **Step 5: Commit** `feat(screencast): add node binding and native build pipeline`

### Task 7: Electron main process, utility worker and preload

**Files:**
- Create: `src/main/screencast.js`, `src/main/screencast-worker.js`, `src/main/screencast-flow.js`
- Modify: `src/main/index.js` (IPC wiring), `src/preload.js` (bridge)
- Test: `test/screencast-flow.test.js`, `test/screencast-controller.test.js`

**Interfaces:**
- Consumes: native `ScreenCapture`.
- Produces:
  - `screencast-flow.js`: `class FrameFlow { constructor(limit = 2); tryAcquire(): boolean; release(): void; get inFlight(): number }`
  - `screencast.js`: `isSupported(): boolean`; `start(webContents, options): Promise<{ width, height, sourceType }>`; `stop(): void`; `onEnded(listener: (reason: string) => void): void`; plus `createController({ fork, createChannel, env, platform, moduleExists })` returning the same API for tests.
  - IPC: `screencast:is-supported`, `screencast:start`, `screencast:stop` (invoke); `screencast:ended` (event, reason string); `screencast:port` (webContents.postMessage with one port).
  - Worker protocol (parentPort): `{ type: 'start', options }` + port → replies `{ type: 'started', info }` or `{ type: 'error', message }`; `{ type: 'stop' }`; worker → `{ type: 'ended', reason }`. Renderer port messages: worker → `{ type: 'frame', seq, width, height, data }`; renderer → `{ type: 'ack', seq }`.
  - Preload: `window.gimodi.screencast = { isSupported(), start(options), stop(), onEnded(cb), removeEndedListener() }`; forwards the port with `window.postMessage({ type: 'gimodi:screencast-port' }, '*', ports)`.

- [ ] **Step 1: Write the failing tests:**
  - `FrameFlow`: two `tryAcquire()` true, third false; after `release()` true again; `release()` below zero keeps `inFlight` at 0.
  - Controller (fake `fork` returning an EventEmitter with `postMessage`/`kill`, fake channel): `isSupported()` false for platform `win32`, for `XDG_SESSION_TYPE=x11` without `WAYLAND_DISPLAY`, when `GIMODI_SCREEN_CAPTURE=legacy`, and when the module file is missing; `start` resolves with the worker's `started` info; rejects with the worker's error message; a worker `exit` while capturing calls the ended listener once with `worker exited`; `stop()` posts `{ type: 'stop' }` and kills the worker after 2000 ms if it is still alive.
- [ ] **Step 2: Run** `npm test` → FAIL.
- [ ] **Step 3: Implement** the three modules, IPC handlers in `index.js` and the preload bridge.
- [ ] **Step 4: Run** `npm test` → PASS; `npx eslint src/main/screencast*.js src/preload.js test/` → no new errors.
- [ ] **Step 5: Commit** `feat(screencast): run native capture in an electron utility process`

### Task 8: Renderer capture track and screen service

**Files:**
- Create: `src/renderer/services/screen-presets.js`, `src/renderer/services/portal-capture.js`
- Modify: `src/renderer/services/screen.js`
- Test: `test/screen-presets.test.js`

**Interfaces:**
- Consumes: `window.gimodi.screencast`, port message protocol from Task 7.
- Produces:
  - `screen-presets.js`: `getScreenPreset(resolution: string, fps: number) -> { width, height, maxBitrate, startBitrateKbps }` (unknown values fall back to 1080 / 30); `isCancelledCaptureError(message: string): boolean` (`true` for `cancelled:` prefix and for `NotAllowedError`-style legacy cancels handled by the caller).
  - `portal-capture.js`: `startPortalCapture({ maxWidth, maxHeight, fps, onEnded }): Promise<{ track: MediaStreamTrack, info, stop(): void }>`
  - `screen.js`: `ScreenShareService` gains `_fps` (default 30), `usesPortalCapture` (set in `init()`), and uses both in `startSharing()`.

Behaviour of `portal-capture.js`: wait for the `gimodi:screencast-port` message (posted during `screencast.start`), create `MediaStreamTrackGenerator({ kind: 'video' })`, set `contentHint = 'motion'`, convert each frame message to `VideoFrame` (`format: 'I420'`, `codedWidth/Height` from the message, `timestamp` from `performance.now() * 1000`), write it, close the previous kept frame, ack the `seq`; keepalive timer every 250 ms writes `new VideoFrame(lastFrame, { timestamp })` when the last write is ≥ 500 ms old; `stop()` stops the native capture, the timer, closes frames and stops the generator; `screencast:ended` → `stop()` + `onEnded(reason)`.

`screen.js`: presets from `getScreenPreset(this._resolution, this._fps)`; portal path when `usesPortalCapture`, otherwise `getDisplayMedia({ video: { frameRate: { ideal: fps }, width: { ideal }, height: { ideal } }, audio: true })`; portal failure that is not a cancel logs and retries once via `getDisplayMedia`; `produce({ track, encodings: [{ maxBitrate, maxFramerate: fps }], codecOptions: { videoGoogleStartBitrate: startBitrateKbps }, appData: { screen: true } })`; `contentHint = 'motion'` on both paths; `stopSharing()` also stops the portal capture.

- [ ] **Step 1: Write the failing tests** (`test/screen-presets.test.js`): `getScreenPreset('1080', 30)` → `{ width: 1920, height: 1080, maxBitrate: 5000000, startBitrateKbps: 2500 }`; `getScreenPreset('1080', 60).maxBitrate === 8000000`; `getScreenPreset('2160', 60)` → `startBitrateKbps === 3000`; `getScreenPreset('999', 45)` equals the 1080/30 preset; `isCancelledCaptureError('cancelled: Portal request was cancelled')` true, `isCancelledCaptureError('error: boom')` false.
- [ ] **Step 2: Run** `npm test` → FAIL.
- [ ] **Step 3: Implement** the two services and the `screen.js` changes.
- [ ] **Step 4: Run** `npm test` and `npm run build` → PASS / bundle builds; eslint on the touched files → no new errors.
- [ ] **Step 5: Commit** `feat(screen): produce portal capture track with fps presets`

### Task 9: Screen share dialog with frame-rate option

**Files:**
- Modify: `src/renderer/index.html` (modal), `src/renderer/views/voice/voice.js`, `src/renderer/style.css` if the new controls need layout

**Interfaces:**
- Consumes: `screenShareService._fps`, `_resolution`, `_wantAudio`, `usesPortalCapture`, `startSharing()`.
- Produces: `<select id="select-screen-fps">` (`30` "30 fps" selected, `60` "60 fps") inside `.screen-picker-options`; `<button id="btn-start-screen" class="btn-primary">Share</button>` shown only in options mode; setting `screenShareFps` persisted like `screenShareResolution`.

Behaviour: when `usesPortalCapture`, the screen share button opens the modal in options mode (source grid hidden, Share button visible); Share stores audio/resolution/fps on the service, hides the modal and calls `startSharing()`; Cancel just hides it. Legacy mode keeps today's flow and additionally applies the fps select when a source is clicked.

- [ ] **Step 1: Verify the current behaviour first:** `npm run build` passes; note the modal markup (`index.html` lines 297-319).
- [ ] **Step 2: Implement** markup and wiring.
- [ ] **Step 3: Run** `npm run build` and eslint on `voice.js` → no new errors; start the dev client and confirm the modal shows the fps select in both modes (screenshot via the app or manual check during Task 10).
- [ ] **Step 4: Commit** `feat(ui): add frame-rate option and portal share flow`

### Task 10: Integration verification on GNOME 50

**Files:**
- Create (scratchpad only, not committed): harness reusing the real `src/main/screencast.js` and `portal-capture.js` path, or the dev client against a local gimodi server.

- [ ] **Step 1:** Run the dev client against a local server (`server/` `npm start`), join voice, share DP-1 with 1080p/30 while a 30 fps animation runs; collect outbound-rtp `framesPerSecond` every second for 30 s across cursor still / other monitor / moving → ≥ 27 fps in all phases.
- [ ] **Step 2:** Repeat with 60 fps and 60 fps content → ≥ 50 fps.
- [ ] **Step 3:** Fullscreen video on the shared monitor (direct scanout) keeps ≥ 27 fps at 30 fps.
- [ ] **Step 4:** Stop via the GNOME sharing indicator → share ends in gimodi, no `gimodi` utility process left (`ps`).
- [ ] **Step 5:** `GIMODI_SCREENCAST_NO_GPU=1` → capture still works (CPU path); `GIMODI_SCREEN_CAPTURE=legacy` and a removed `.node` → `getDisplayMedia` path works.
- [ ] **Step 6:** Packaged build (`npm run package`) loads the native module from the asar-unpacked path inside the utility process.
- [ ] **Step 7:** Fix anything found (each fix with its own test where possible) and commit.

### Task 11: Release

- [ ] **Step 1:** Merge `chore/remove-tauri` and `feat/wayland-screencast` into `main` (preserve the uncommitted work in the main checkout on a separate branch first).
- [ ] **Step 2:** Bump `package.json` version to `1.9.0`, commit `chore: bump version to 1.9.0`.
- [ ] **Step 3:** Tag `v1.9.0`.
- [ ] **Step 4:** `npm run deploy:linux:deb`; verify the .deb contains `screencast.node` and installs/starts (inspect with `dpkg-deb -c`).
