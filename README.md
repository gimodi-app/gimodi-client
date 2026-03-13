# Gimodi

A cross-platform voice and video chat desktop application built with Electron.

![Screenshot](https://gimodi.com/slider/01-overall.png)

## Requirements

- [Node.js](https://nodejs.org/) (v18+)
- npm

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
| `npm run package` | Package the app without creating an installer |
| `npm run make`    | Create platform-specific installers           |

### Distribution

```bash
npm run deploy:win    # Windows installer
npm run deploy:mac    # macOS installer
npm run deploy:linux  # Linux packages (deb, AppImage)
```

## Tech Stack

- **[Electron](https://www.electronjs.org/)** — Desktop application framework
- **[mediasoup-client](https://mediasoup.org/)** — WebRTC media transport for voice/video
- **[OpenPGP.js](https://openpgpjs.org/)** — End-to-end encryption
- **[marked](https://marked.js.org/) + [highlight.js](https://highlightjs.org/)** — Markdown and code highlighting
- **[@jitsi/rnnoise-wasm](https://github.com/jitsi/rnnoise-wasm)** — Noise suppression
- **[Electron Forge](https://www.electronforge.io/)** — Packaging and distribution

## License

See [LICENSE](LICENSE) for details.
