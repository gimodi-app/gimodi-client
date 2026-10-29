# Gimodi

A cross-platform voice and video chat desktop application built with Electron.

![Screenshot](https://gimodi.com/slider/01-overall.png)

## Requirements

- [Node.js](https://nodejs.org/) (v18+)
- npm

On Linux, the Wayland screen capture module (`native/screencast`, Rust) additionally needs:

- [Rust](https://rustup.rs/) (cargo)
- clang, pkg-config and the PipeWire development files, e.g. on Debian/Ubuntu:
  `sudo apt install clang pkg-config libpipewire-0.3-dev libspa-0.2-dev`

Without cargo the module is skipped and screen sharing falls back to Chromium's capturer.

## Getting Started

```bash
npm install
npm start
```

This builds the renderer bundle and launches the app in development mode.

## Scripts

| Command           | Description                                   |
| ----------------- | --------------------------------------------- |
| `npm start`       | Build and run in development mode             |
| `npm run build`   | Build the renderer bundle only                |
| `npm run build:native` | Build the Linux screen capture module    |
| `npm test`        | Run the unit tests                            |
| `npm run package` | Package the app without creating an installer |
| `npm run make`    | Create platform-specific installers           |

### Distribution

```bash
npm run deploy:win    # Windows installer
npm run deploy:mac    # macOS installer
npm run deploy:linux  # Linux packages (deb, AppImage)
```

### Releases

Releases are built and published by GitHub Actions (`.github/workflows/release.yml`). Bump the version, then push the commit and a matching tag:

```bash
npm version 1.11.0 --no-git-tag-version
git commit -am "chore: bump version to 1.11.0"
git tag v1.11.0
git push origin main v1.11.0
```

The workflow builds Linux (deb, AppImage, zip), Windows (Squirrel, zip) and macOS (zip) installers, uploads them to a draft release and publishes it once all files are there. A tag with a suffix such as `v1.12.0-beta.1` becomes a prerelease. The client updater reads the GitHub releases API: the `stable` channel takes the highest release, `beta` and `nightly` also take prereleases.

## Tech Stack

- **[Electron](https://www.electronjs.org/)** — Desktop application framework
- **[mediasoup-client](https://mediasoup.org/)** — WebRTC media transport for voice/video
- **[OpenPGP.js](https://openpgpjs.org/)** — End-to-end encryption
- **[marked](https://marked.js.org/) + [highlight.js](https://highlightjs.org/)** — Markdown and code highlighting
- **[@jitsi/rnnoise-wasm](https://github.com/jitsi/rnnoise-wasm)** — Noise suppression
- **[Electron Forge](https://www.electronforge.io/)** — Packaging and distribution

## License

See [LICENSE](LICENSE) for details.
