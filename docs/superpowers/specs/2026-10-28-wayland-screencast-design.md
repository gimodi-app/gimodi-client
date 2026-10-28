# Wayland screen capture via portal with embedded cursor

Date: 2026-10-28
Status: direction, Rust and the 60 fps option confirmed by Patrick, who asked to start directly. Points not discussed are listed under "Builder's calls".

## Intent

Screen sharing in the Electron client must transmit fast-moving content (YouTube videos, games) smoothly on Wayland, independent of where the mouse cursor is, the way Discord does.

Today gimodi uses `getDisplayMedia` (Chromium's PipeWire capturer). On GNOME 50 (Ubuntu 26.04, mutter 50.1) the shared picture drops to roughly 0-3 fps while the cursor is still or on another monitor and recovers only while the cursor moves on the shared monitor.

### Root cause (verified 2026-10-28)

- Chromium/libwebrtc always asks the ScreenCast portal for `cursor_mode=4` (cursor as metadata). There is no Electron or Chromium switch to change this on Linux.
- mutter 50 (MR !4923) records a cursor-only buffer on every stage `prepare-frame` of any monitor while the shared monitor has no redraw queued. Each of these buffers consumes the stream's max-framerate budget, so content frames are throttled away ("too early").
- Fixed upstream in mutter 51 (commit 9d0d1832, MR !5158). Not in 50.x (checked 50.6) and not in Ubuntu 50.1-0ubuntu2.5. Ubuntu 26.04 LTS will stay on mutter 50.
- Discord's own Rust capture (ashpd + pipewire-rs) requests `cursor_mode=2` (cursor embedded into the frames), which never produces cursor-only buffers.
- Measured with a PipeWire probe against mutter: metadata + shm buffers 0.2 fps, metadata + DMA-BUF ~17 fps erratic, embedded 19-25 fps stable with zero cursor-only buffers (30 fps content, 2560x1440 monitor).
- Additionally, mutter < 50.5 only records frames for DMA-BUF streams while a fullscreen client is scanned out directly (commit 2021ac0c "Fix direct scanout handling without dma-buf"). Fullscreen games and videos therefore need DMA-BUF.

## Goals

- On Linux Wayland sessions, capture screens and windows through the xdg-desktop-portal ScreenCast interface with `cursor_mode=2` (embedded).
- Receive frames as DMA-BUF and convert them on the GPU (EGL + GLES): crop, scale to the selected resolution, convert to I420. Shared-memory buffers remain a CPU fallback.
- Deliver the frames to the renderer as a `MediaStreamTrack` (`MediaStreamTrackGenerator`) and produce it through mediasoup like today's screen track.
- Add a frame-rate option (30 or 60 fps) next to the resolution option, used by both capture paths.
- Encoder settings suited to motion content: `contentHint = 'motion'`, max bitrate per resolution and frame rate, `maxFramerate` per encoding.
- Fall back to the existing `getDisplayMedia` path automatically when the native module is missing, cannot load, or the portal start fails for a reason other than the user cancelling.

## Non-goals

- No change for Windows, macOS and X11 sessions (they keep `getDisplayMedia`), except the new frame-rate option.
- Audio stays on venmic; no change to audio capture.
- No server or codec change (mediasoup router stays VP8-only).
- No hardware video encoding, no simulcast.
- No persistent portal permissions (restore tokens); every share shows the portal dialog.

## Anti-goals

- Crashes in native capture code must never take down the app: native code runs in an Electron utility process.
- The app must still start and share the screen when PipeWire, EGL or GBM are unavailable.
- No hard runtime dependency added to the .deb package.

## Constraints

- Electron 43.2.0 (Chromium 150). Verified in this environment: `MediaStreamTrackGenerator` exists on `window` in sandboxed, context-isolated renderers and accepts I420 `VideoFrame`s; `VideoTrackGenerator` does not exist (window or worker).
- Renderers are sandboxed with context isolation; native modules can only run in the main or a utility process.
- Releases are built locally on Linux with electron-forge (deb, AppImage, zip). There is no CI.
- Build-time requirements for the native module: Rust (cargo), clang/libclang (bindgen), pkg-config, `libpipewire-0.3-dev`, `libspa-0.2-dev`. Runtime: `libpipewire-0.3.so.0` (linked), `libEGL.so.1` and `libgbm.so.1` (loaded at runtime, optional).
- Project rules: JSDoc on all JS functions, no inline comments, English text everywhere, Conventional Commits.

## Design

### Components

```
Renderer (sandboxed)                Main process                    Utility process
screen.js ──────────────┐           src/main/screencast.js          src/main/screencast-worker.js
  legacy: getDisplayMedia│           ├ isSupported()                 └ native/screencast (Rust, napi-rs)
  portal: portal-capture.js          ├ start(opts) ── fork ─────────▶   portal (ashpd, cursor embedded)
    ├ MessagePort ◀──────── MessageChannelMain ──────────────────────▶ PipeWire stream thread
    ├ MediaStreamTrackGenerator      ├ stop()                           ├ GPU: EGL/GBM + GLES3 → I420
    └ keepalive (repeat last frame)  └ 'screencast:ended' event         └ CPU fallback: resize + I420
```

### Native module `native/screencast` (Rust, cdylib loaded as `screencast.node`)

JS API (napi-rs):

- `new ScreenCapture()`
- `start(options, onFrame, onEvent): Promise<{ width, height, sourceType }>`
  - `options`: `{ maxWidth, maxHeight, fps }`.
  - Runs the portal flow: `CreateSession`, `SelectSources(types = Monitor | Window, multiple = false, cursor_mode = Embedded, persist_mode = DoNot)`, `Start`, `OpenPipeWireRemote`.
  - Resolves once the portal returned a stream; rejects with an error whose message starts with `cancelled:` when the user cancels, `unsupported:` when the portal or embedded cursor mode is unavailable, `error:` otherwise.
  - `onFrame({ data, width, height })`: `data` is an I420 `Buffer` (Y plane, then U, then V, tightly packed).
  - `onEvent({ type, message })` with `type` `ended` (portal session closed or stream gone) or `error`.
- `stop()`: idempotent; stops the stream, closes the portal session, joins threads.

Threads:

- Portal thread: runs the ashpd flow with a lightweight executor, then waits for either the session `Closed` signal or a stop request, then closes the session.
- PipeWire thread: `MainLoop` connected with the portal's fd to the node id, stops through a pipewire channel.
- Frames go to JS through a non-blocking threadsafe function with a queue of one; if JS is busy the frame is dropped (the next one is newer anyway).

PipeWire negotiation (mirrors libwebrtc, which works on this machine):

- `EnumFormat` per pixel format (BGRA, BGRx, RGBA, RGBx): one variant with the EGL-supported DRM modifiers (`MANDATORY | DONT_FIXATE`), one without modifier (shm). `framerate 0/1`, `maxFramerate` range up to the requested fps.
- On `Format`: buffers param with `DmaBuf | MemFd` when a modifier was negotiated, else `MemFd | MemPtr`; meta params `Header` and `VideoCrop`.
- `process`: dequeue all buffers, keep the newest, requeue the rest. Skip buffers flagged corrupted or with empty chunks. Honour `VideoCrop` (GNOME window streams are full-screen sized with a crop).
- If a DMA-BUF import fails, drop that modifier and renegotiate (`update_params`); with no modifiers left only shm remains.

Output size: fit the (cropped) source into `maxWidth x maxHeight` keeping the aspect ratio, never upscale, width rounded down to a multiple of 8 and height to a multiple of 2 (required by the packed GPU readback and I420).

GPU path:

- `libgbm.so.1` and `libEGL.so.1` loaded at runtime; GBM device on the first DRM render node; `EGL_PLATFORM_GBM_KHR` display; GLES 3 context, surfaceless.
- Modifier list per format from `eglQueryDmaBufModifiersEXT`.
- Per frame: `eglCreateImage(EGL_LINUX_DMA_BUF_EXT)` with all planes, bound to a `GL_TEXTURE_EXTERNAL_OES` texture. Three render passes into RGBA8 targets pack 4 output samples per texel: Y at `W/4 x H`, U and V at `W/8 x H/2` each. BT.601 limited range (same as Chromium's desktop capture via libyuv). Bilinear sampling scales; chroma samples the centre of each 2x2 block. `glReadPixels(RGBA, UNSIGNED_BYTE)` writes straight into the I420 buffer.
- Any EGL/GBM init failure disables the GPU path for the session and only shm formats are offered.

CPU fallback path: shm buffers are cropped, resized (`fast_image_resize`, SIMD) and converted to I420 BT.601 limited (`yuvutils-rs`).

### Electron main process `src/main/screencast.js`

- `isSupported()`: Linux, Wayland session (`XDG_SESSION_TYPE=wayland` or `WAYLAND_DISPLAY`), the native module file exists, and `GIMODI_SCREEN_CAPTURE` is not `legacy`.
- `start(webContents, options)`: forks `screencast-worker.js` as a utility process, creates a `MessageChannelMain`, hands one port to the worker and one to the renderer (`webContents.postMessage('screencast:port', null, [port])`), resolves with the worker's `started` reply or rejects with its error.
- `stop()`: asks the worker to stop, kills it if it does not exit within 2 s.
- Worker exit or `ended` event while sharing → `screencast:ended` to the renderer.
- IPC: `screencast:is-supported`, `screencast:start`, `screencast:stop` (invoke), `screencast:ended` (event).

### Utility worker `src/main/screencast-worker.js`

- Loads the native module, runs one capture per process.
- Posts frames to the renderer port as `{ data, width, height }` with flow control: at most 2 frames in flight, the renderer acks each frame; frames arriving above that are dropped.

### Preload

`window.gimodi.screencast = { isSupported, start, stop, onEnded, removeEndedListener }`. The frame port arrives via `ipcRenderer.on('screencast:port')` and is forwarded into the main world with `window.postMessage({ type: 'gimodi:screencast-port' }, '*', ports)`.

### Renderer

`src/renderer/services/portal-capture.js` creates the track:

- Requests the port, calls `screencast.start`, builds a `MediaStreamTrackGenerator({ kind: 'video' })`.
- Each port message becomes `new VideoFrame(data, { format: 'I420', codedWidth, codedHeight, timestamp })` written to the generator; timestamps are taken from `performance.now()` on arrival.
- Keepalive: if no frame arrived for 500 ms, the last frame is written again with a new timestamp, so receivers joining a static screen still get a key frame.
- `stop()` stops the capture and the generator track; `screencast:ended` ends the share in `screen.js`.

`screen.js`:

- Presets: resolution (720/1080/1440/2160) x fps (30/60) → `{ width, height, maxBitrate }`. Bitrates (VP8, high motion): 720p 2.5/4 Mbps, 1080p 5/8 Mbps, 1440p 8/12 Mbps, 2160p 14/20 Mbps (30/60 fps).
- Uses the portal path when `screencast.isSupported()` is true, otherwise `getDisplayMedia` with `frameRate: { ideal: fps }`.
- `produce()` with `encodings: [{ maxBitrate, maxFramerate: fps }]`, `codecOptions: { videoGoogleStartBitrate }` (half the max bitrate, at most 3000 kbps), `track.contentHint = 'motion'`.
- If the portal path fails with anything but `cancelled:`, it logs the error and retries once through `getDisplayMedia`.

UI (`index.html`, `voice.js`):

- New "Frame rate" select (30 fps, 60 fps) next to "Resolution", persisted as `screenShareFps`.
- Portal path: the screen share button opens the modal in options mode (no source grid, a "Share" button); "Share" closes it and starts the portal flow, which shows the GNOME source dialog.
- Legacy path: unchanged picker behaviour, plus the frame-rate select.

### Build and packaging

- `scripts/build-native.js`: on Linux runs `cargo build --release` in `native/screencast` and copies `libgimodi_screencast.so` to `native/screencast/screencast.node`; no-op on other platforms or when cargo is missing (prints why).
- `npm run build:native`; called from `start`, `package`, `make` and the Linux `deploy:*` scripts.
- forge `ignore`: Rust sources, `Cargo.*`, `build.rs` and `target/` under `native/screencast`. The `.node` file and its loader ship in the package. If native modules cannot be loaded from the asar inside a utility process, unpack `*.node` via `packagerConfig.asar.unpack`.
- `.gitignore`: `native/screencast/target/`, `native/screencast/*.node`.

## Testing and acceptance

- Rust unit tests: output size fitting, SPA ↔ DRM format mapping, BT.601 conversion of known colours (CPU), GPU conversion against the CPU reference on a synthetic texture (skipped without EGL), pod building for formats with and without modifiers.
- JS unit tests with `node --test` (no new dependencies) for the presets and the frame flow control.
- Integration on this machine (GNOME 50.1, NVIDIA, 2560x1440 + 1920x1080) with an Electron harness and a portal click:
  - 30 fps content: delivered fps ≥ 27 with the cursor still, on the other monitor, and moving.
  - 60 fps setting and 60 fps content: ≥ 50 fps.
  - Fullscreen video (direct scanout) keeps flowing.
  - Stopping via the GNOME sharing indicator ends the share in gimodi.
  - Missing native module falls back to `getDisplayMedia`.
- End-to-end in gimodi against a local server: the screen producer sends at the selected fps (outbound-rtp stats).
- Release: version bump, release tag, `.deb` built with `deploy:linux:deb`.

## Builder's calls

- The portal path is used on every Wayland session, not only GNOME 50.
- Options-first modal on the portal path (GNOME shows its own source dialog afterwards).
- Bitrate table, start bitrate, `contentHint = 'motion'` for all shares.
- 500 ms keepalive repeat of the last frame.
- `GIMODI_SCREEN_CAPTURE=legacy` as the only switch back to `getDisplayMedia`.
- BT.601 limited range output, matching Chromium's desktop capture.

## Left to the builder

- Exact crate versions and napi-rs v3 API details.
- Whether EGLImages are cached per PipeWire buffer.
- Shader details and the downscale filter quality.
- Logging format (prefix `[screencast]`).

## Risks

- NVIDIA EGL/GBM quirks or implicit-sync artefacts on DMA-BUF imports. Mitigation: shm fallback, modifier blacklist.
- Hybrid-GPU systems where the compositor's GPU is not the first render node. Mitigation: import failure → shm fallback.
- IPC copy cost at 2160p60 (~750 MB/s). Mitigation: acceptable for an explicit 4K60 choice; frames are dropped under backpressure.
