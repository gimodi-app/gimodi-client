import connectionManager from './connectionManager.js';
import voiceService from './voice.js';
import { startPortalCapture } from './portal-capture.js';
import { getScreenPreset, isCancelledCaptureError } from './screen-presets.js';
import { createRecoveryPolicy } from './screen-audio-recovery.js';

const log = (...args) => console.log('[screen]', ...args);
const err = (...args) => console.error('[screen]', ...args);

const AUDIO_CHECK_INTERVAL_MS = 10000;
const AUDIO_RECOVERY_OPTIONS = { cooldownMs: 30000, maxRecoveries: 5 };

/**
 * Logs a screen share audio event to the console and to the diagnostics log file.
 * @param {string} message - What happened.
 * @param {object} [data] - Details.
 * @returns {void}
 */
function audioLog(message, data) {
  console.log('[screen-audio]', message, data ?? '');
  window.gimodi.screenAudioLog?.('screen', message, data);
}

class ScreenShareService extends EventTarget {
  constructor() {
    super();
    /** @type {import('mediasoup-client').Producer|null} */
    this.videoProducer = null;
    /** @type {import('mediasoup-client').Producer|null} */
    this.audioProducer = null;
    /** @type {MediaStream|null} */
    this.stream = null;
    /** @type {string|null} */
    this._platform = null;
    /** @type {boolean} */
    this._venmicAvailable = false;
    /** @type {boolean} */
    this._wantAudio = true;
    /** @type {string} */
    this._resolution = '1080';
    /** @type {number} */
    this._fps = 30;
    /** @type {boolean} */
    this.usesPortalCapture = false;
    /** @type {{track: MediaStreamTrack, stop: () => void}|null} */
    this._portalCapture = null;
    /** @type {{timer: ReturnType<typeof setInterval>, policy: ReturnType<typeof createRecoveryPolicy>, lastStats: object|null, checking: boolean}|null} */
    this._audioMonitor = null;
  }

  /** @returns {boolean} */
  get _usesVenmic() {
    return this._platform === 'linux' && this._venmicAvailable;
  }

  /**
   * @returns {Promise<void>}
   */
  async init() {
    this._platform = await window.gimodi.screen.getPlatform();
    this.usesPortalCapture = Boolean(await window.gimodi.screencast?.isSupported());
    if (this._platform === 'linux') {
      this._venmicAvailable = await window.gimodi.venmic.isAvailable();
      log('Platform: linux, venmic available:', this._venmicAvailable, 'portal capture:', this.usesPortalCapture);
    } else {
      log('Platform:', this._platform);
    }
  }

  /** @returns {boolean} */
  get isSharing() {
    return this.videoProducer !== null;
  }

  /** @returns {boolean} */
  get supportsAudio() {
    return this._platform === 'win32' || (this._platform === 'linux' && this._venmicAvailable);
  }

  /**
   * @returns {Promise<void>}
   */
  async startSharing() {
    if (!voiceService.sendTransport) {
      err('No send transport available');
      return;
    }

    const preset = getScreenPreset(this._resolution, this._fps);
    let videoTrack;
    try {
      videoTrack = await this._captureVideo(preset);
    } catch (e) {
      if (!isCancelledCaptureError(e)) {
        err('Failed to capture the screen:', e.message);
      }
      return;
    }
    if (!videoTrack) {
      err('No video track from screen capture');
      return;
    }

    let audioTrack = null;

    if (this._wantAudio) {
      if (this._usesVenmic) {
        const accepted = await window.gimodi.venmic.startSystem([]);
        audioLog('Venmic started', { accepted });
        audioTrack = await this._getVenmicAudioTrack();
        if (!audioTrack) {
          audioLog('Sharing without audio, no venmic track');
          window.gimodi.venmic.stop();
        }
      } else {
        audioTrack = this.stream.getAudioTracks()[0] || null;
      }
    }

    log('Got screen stream, video:', videoTrack?.label, 'audio:', audioTrack?.label, 'preset:', preset);

    videoTrack.contentHint = 'motion';
    videoTrack.onended = () => {
      log('Video track ended by user');
      this.stopSharing();
    };

    try {
      this.videoProducer = await voiceService.sendTransport.produce({
        track: videoTrack,
        encodings: [{ maxBitrate: preset.maxBitrate, maxFramerate: preset.fps }],
        codecOptions: { videoGoogleStartBitrate: preset.startBitrateKbps },
        appData: { screen: true },
      });
    } catch (e) {
      this._stopPortalCapture();
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
      if (this._usesVenmic) {
        window.gimodi.venmic.stop();
      }
      throw e;
    }
    log('Screen video producer created:', this.videoProducer.id);

    this.videoProducer.on('transportclose', () => {
      this.videoProducer = null;
    });

    if (audioTrack) {
      this.audioProducer = await voiceService.sendTransport.produce({
        track: audioTrack,
        appData: { screen: true, screenAudio: true },
      });
      audioLog('Screen audio producer created', { producerId: this.audioProducer.id });

      this.audioProducer.on('transportclose', () => {
        audioLog('Screen audio producer transport closed');
        this.audioProducer = null;
      });
      this._watchAudioTrack(audioTrack);
      if (this._usesVenmic) {
        this._startAudioMonitor();
      }
    }

    connectionManager.getVoice()?.send('screen:start', {});
    this.dispatchEvent(new CustomEvent('started', { detail: { videoTrack, audioTrack, stream: this.stream } }));
  }

  /**
   * Captures the screen through the Wayland portal when available, otherwise
   * (or when the portal path fails for another reason than a cancel) through
   * `getDisplayMedia`. Sets `this.stream`.
   * @private
   * @param {{width: number, height: number, fps: number}} preset - Capture settings.
   * @returns {Promise<MediaStreamTrack|undefined>}
   * @throws {Error} When the capture fails or the user cancels the selection.
   */
  async _captureVideo(preset) {
    if (this.usesPortalCapture) {
      try {
        this._portalCapture = await startPortalCapture({
          maxWidth: preset.width,
          maxHeight: preset.height,
          fps: preset.fps,
          onEnded: (reason) => {
            log('Portal capture ended:', reason);
            this.stopSharing();
          },
        });
        this.stream = new MediaStream([this._portalCapture.track]);
        return this._portalCapture.track;
      } catch (e) {
        if (isCancelledCaptureError(e)) {
          throw e;
        }
        err('Portal capture failed, falling back to getDisplayMedia:', e.message);
      }
    }
    this.stream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        frameRate: { ideal: preset.fps },
        width: { ideal: preset.width },
        height: { ideal: preset.height },
      },
      audio: true,
    });
    return this.stream.getVideoTracks()[0];
  }

  /**
   * Stops the portal capture, if one is running.
   * @private
   * @returns {void}
   */
  _stopPortalCapture() {
    this._portalCapture?.stop();
    this._portalCapture = null;
  }

  /**
   * @private
   * @returns {Promise<MediaStreamTrack|null>}
   */
  async _getVenmicAudioTrack() {
    try {
      await new Promise((r) => setTimeout(r, 200));

      const devices = await navigator.mediaDevices.enumerateDevices();
      const venmicDevices = devices.filter((d) => d.kind === 'audioinput' && (d.label.toLowerCase().includes('vencord') || d.label.toLowerCase().includes('venmic')));
      const venmicDevice = venmicDevices[0];

      if (!venmicDevice) {
        audioLog('Venmic device not found in audio inputs', { inputs: devices.filter((d) => d.kind === 'audioinput').map((d) => d.label) });
        return null;
      }

      audioLog('Found venmic device', { label: venmicDevice.label, deviceId: venmicDevice.deviceId, candidates: venmicDevices.length });

      const venmicStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { exact: venmicDevice.deviceId },
          autoGainControl: false,
          echoCancellation: false,
          noiseSuppression: false,
          channelCount: 2,
          sampleRate: 48000,
        },
      });

      return venmicStream.getAudioTracks()[0];
    } catch (e) {
      audioLog('Failed to get venmic audio track', { name: e.name, message: e.message });
      return null;
    }
  }

  /**
   * Logs the life cycle of a screen audio track and checks the audio health at
   * once when the track ends while it is still being sent.
   * @private
   * @param {MediaStreamTrack} track - Track sent by the audio producer.
   * @returns {void}
   */
  _watchAudioTrack(track) {
    audioLog('Audio track attached', { label: track.label, readyState: track.readyState, muted: track.muted, settings: track.getSettings() });
    track.addEventListener('mute', () => audioLog('Audio track muted', { label: track.label }));
    track.addEventListener('unmute', () => audioLog('Audio track unmuted', { label: track.label }));
    track.addEventListener('ended', () => {
      audioLog('Audio track ended', { label: track.label, current: track === this.audioProducer?.track });
      if (track === this.audioProducer?.track) {
        this._checkAudioHealth();
      }
    });
  }

  /**
   * Starts the periodic venmic audio health check.
   * @private
   * @returns {void}
   */
  _startAudioMonitor() {
    this._stopAudioMonitor();
    this._audioMonitor = {
      timer: setInterval(() => this._checkAudioHealth(), AUDIO_CHECK_INTERVAL_MS),
      policy: createRecoveryPolicy(AUDIO_RECOVERY_OPTIONS),
      lastStats: null,
      checking: false,
    };
    this._checkAudioHealth();
  }

  /**
   * @private
   * @returns {void}
   */
  _stopAudioMonitor() {
    if (this._audioMonitor) {
      clearInterval(this._audioMonitor.timer);
      this._audioMonitor = null;
    }
  }

  /**
   * Logs the state of the sent audio and of the PipeWire graph, and rebuilds
   * the venmic capture when the recovery policy asks for it.
   * @private
   * @returns {Promise<void>}
   */
  async _checkAudioHealth() {
    const monitor = this._audioMonitor;
    const producer = this.audioProducer;
    if (!monitor || monitor.checking || !producer) {
      return;
    }
    monitor.checking = true;
    try {
      const [graph, stats] = await Promise.all([window.gimodi.venmic.diagnose(), this._readAudioStats(producer, monitor)]);
      if (monitor !== this._audioMonitor || producer !== this.audioProducer) {
        return;
      }
      const track = producer.track;
      audioLog('Health check', {
        track: track ? { readyState: track.readyState, muted: track.muted, enabled: track.enabled } : null,
        producerPaused: producer.paused,
        ...stats,
        problems: graph.problems,
        graphError: graph.error,
      });
      const decision = monitor.policy.decide({ trackEnded: !track || track.readyState === 'ended', problems: graph.problems, now: Date.now() });
      if (decision.action !== 'none') {
        audioLog(`Recovery ${decision.action}`, { reason: decision.reason });
      }
      if (decision.action === 'recover') {
        await this._restartVenmicAudio(producer);
      }
    } catch (e) {
      audioLog('Health check failed', { message: e.message });
    } finally {
      monitor.checking = false;
    }
  }

  /**
   * Reads the sender stats of the audio producer as changes since the previous check.
   * @private
   * @param {import('mediasoup-client').Producer} producer - Screen audio producer.
   * @param {{lastStats: object|null}} monitor - Monitor that keeps the previous stats.
   * @returns {Promise<{bytesSentDelta: number, packetsSentDelta: number, energyDelta: number, audioLevel: number|null}>}
   */
  async _readAudioStats(producer, monitor) {
    const current = { bytesSent: 0, packetsSent: 0, totalAudioEnergy: 0, audioLevel: null };
    const report = await producer.getStats();
    for (const stat of report.values()) {
      if (stat.type === 'outbound-rtp') {
        current.bytesSent = stat.bytesSent ?? 0;
        current.packetsSent = stat.packetsSent ?? 0;
      } else if (stat.type === 'media-source') {
        current.totalAudioEnergy = stat.totalAudioEnergy ?? 0;
        current.audioLevel = stat.audioLevel ?? null;
      }
    }
    const previous = monitor.lastStats ?? current;
    monitor.lastStats = current;
    return {
      bytesSentDelta: current.bytesSent - previous.bytesSent,
      packetsSentDelta: current.packetsSent - previous.packetsSent,
      energyDelta: Number((current.totalAudioEnergy - previous.totalAudioEnergy).toFixed(6)),
      audioLevel: current.audioLevel,
    };
  }

  /**
   * Rebuilds the venmic node and the capture track and swaps the new track
   * into the running audio producer, which is what restarting the share did.
   * @private
   * @param {import('mediasoup-client').Producer} producer - Screen audio producer.
   * @returns {Promise<void>}
   */
  async _restartVenmicAudio(producer) {
    const oldTrack = producer.track;
    await window.gimodi.venmic.stop();
    const accepted = await window.gimodi.venmic.startSystem([]);
    const track = await this._getVenmicAudioTrack();
    const shareEnded = producer !== this.audioProducer || producer.closed;
    if (!track || shareEnded) {
      track?.stop();
      if (shareEnded && !this.isSharing) {
        window.gimodi.venmic.stop();
      }
      audioLog('Recovery failed', { accepted, gotTrack: Boolean(track), shareEnded });
      return;
    }
    await producer.replaceTrack({ track });
    oldTrack?.stop();
    if (this._audioMonitor) {
      this._audioMonitor.lastStats = null;
    }
    this._watchAudioTrack(track);
    audioLog('Recovery done', { accepted, label: track.label });
  }

  /**
   * @returns {void}
   */
  stopSharing() {
    this._stopAudioMonitor();
    this._stopPortalCapture();

    if (this.videoProducer) {
      const track = this.videoProducer.track;
      this.videoProducer.close();
      this.videoProducer = null;
      if (track) {
        track.stop();
      }
    }

    if (this.audioProducer) {
      const track = this.audioProducer.track;
      this.audioProducer.close();
      this.audioProducer = null;
      if (track) {
        track.stop();
      }
    }

    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.stop();
      }
      this.stream = null;
    }

    if (this._usesVenmic) {
      window.gimodi.venmic.stop();
    }

    connectionManager.getVoice()?.send('screen:stop', {});
    this.dispatchEvent(new CustomEvent('stopped'));
  }

  /**
   * @returns {void}
   */
  cleanup() {
    if (this.isSharing) {
      this.stopSharing();
    }
  }
}

const screenShareService = new ScreenShareService();
export default screenShareService;
