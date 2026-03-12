import connectionManager from './connectionManager.js';
import voiceService from './voice.js';

const log = (...args) => console.log('[screen]', ...args);
const err = (...args) => console.error('[screen]', ...args);

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
  }

  /**
   * @returns {Promise<void>}
   */
  async init() {
    this._platform = await window.gimodi.screen.getPlatform();
    if (this._platform === 'linux') {
      this._venmicAvailable = await window.gimodi.venmic.isAvailable();
      log('Platform: linux, venmic available:', this._venmicAvailable);
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

    try {
      const resolutions = { 720: [1280, 720], 1080: [1920, 1080], 1440: [2560, 1440], 2160: [3840, 2160] };
      const [w, h] = resolutions[this._resolution] || resolutions[1080];
      this.stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: 30 },
          width: { ideal: w },
          height: { ideal: h },
        },
        audio: true,
      });
    } catch (e) {
      throw e;
    }

    const videoTrack = this.stream.getVideoTracks()[0];
    if (!videoTrack) {
      err('No video track from getDisplayMedia');
      return;
    }

    let audioTrack = null;

    if (this._wantAudio) {
      if (this._platform === 'linux' && this._venmicAvailable) {
        await window.gimodi.venmic.startSystem([]);
        log('Venmic started, getting audio track');
        audioTrack = await this._getVenmicAudioTrack();
      } else {
        audioTrack = this.stream.getAudioTracks()[0] || null;
      }
    }

    log('Got screen stream, video:', videoTrack?.label, 'audio:', audioTrack?.label);

    videoTrack.onended = () => {
      log('Video track ended by user');
      this.stopSharing();
    };

    try {
      this.videoProducer = await voiceService.sendTransport.produce({
        track: videoTrack,
        appData: { screen: true },
      });
    } catch (e) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
      if (this._platform === 'linux' && this._venmicAvailable) {
        window.gimodi.venmic.stopSystem?.();
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
      log('Screen audio producer created:', this.audioProducer.id);

      this.audioProducer.on('transportclose', () => {
        this.audioProducer = null;
      });
    }

    connectionManager.getVoice()?.send('screen:start', {});
    this.dispatchEvent(new CustomEvent('started', { detail: { videoTrack, audioTrack, stream: this.stream } }));
  }

  /**
   * @private
   * @returns {Promise<MediaStreamTrack|null>}
   */
  async _getVenmicAudioTrack() {
    try {
      await new Promise(r => setTimeout(r, 200));

      const devices = await navigator.mediaDevices.enumerateDevices();
      const venmicDevice = devices.find(d =>
        d.kind === 'audioinput' &&
        (d.label.toLowerCase().includes('vencord') || d.label.toLowerCase().includes('venmic'))
      );

      if (!venmicDevice) {
        log('Venmic device not found in audio inputs');
        return null;
      }

      log('Found venmic device:', venmicDevice.label, venmicDevice.deviceId);

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
      err('Failed to get venmic audio track:', e);
      return null;
    }
  }

  /**
   * @returns {void}
   */
  stopSharing() {
    if (this.videoProducer) {
      const track = this.videoProducer.track;
      this.videoProducer.close();
      this.videoProducer = null;
      if (track) track.stop();
    }

    if (this.audioProducer) {
      const track = this.audioProducer.track;
      this.audioProducer.close();
      this.audioProducer = null;
      if (track) track.stop();
    }

    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.stop();
      }
      this.stream = null;
    }

    if (this._platform === 'linux' && this._venmicAvailable) {
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
