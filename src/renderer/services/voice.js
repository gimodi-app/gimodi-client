import { Device } from 'mediasoup-client';
import connectionManager from './connectionManager.js';

const log = (...args) => console.log('[voice]', ...args);
const err = (...args) => console.error('[voice]', ...args);

/**
 * @returns {import('./serverConnection.js').ServerService|null} The voice connection
 */
function getVoiceConn() {
  return connectionManager.getVoice();
}

class VoiceService extends EventTarget {
  constructor() {
    super();
    /** @type {import('mediasoup-client').Device|null} */
    this.device = null;
    /** @type {import('mediasoup-client').Transport|null} */
    this.sendTransport = null;
    /** @type {import('mediasoup-client').Transport|null} */
    this.recvTransport = null;
    /** @type {import('mediasoup-client').Producer|null} */
    this.micProducer = null;
    /** @type {import('mediasoup-client').Producer|null} */
    this.webcamProducer = null;
    /** @type {Map<string, {consumer: import('mediasoup-client').Consumer, clientId: string, nickname: string, screen: boolean, screenAudio: boolean, webcam: boolean}>} */
    this._consumers = new Map();
    /** @type {string|null} */
    this.selectedMicId = null;
    /** @type {string|null} */
    this.selectedCameraId = null;
    /** @type {string|null} */
    this.selectedSpeakerId = null;
    /** @type {number} 0 = disabled (always transmit), 1-100 = threshold */
    this.voiceActivationLevel = 0;
    /** @type {boolean} */
    this.noiseSuppression = false;
    /** @type {boolean} */
    this._manualMute = false;
    /** @type {boolean} */
    this._deafened = false;
    /** @type {boolean} */
    this.pushToTalkEnabled = false;
    /** @type {string} */
    this.pushToTalkKey = ' ';
    /** @type {boolean} */
    this._pttActive = false;
    /** @type {Map<string, number>} userId → volume (0-100) */
    this._userVolumes = new Map();
    /** @type {AudioContext|null} */
    this._audioContext = null;
    /** @type {Map<string, {analyser: AnalyserNode, source: MediaStreamAudioSourceNode, track: MediaStreamTrack, lastActivity: number}>} */
    this._analysers = new Map();
    /** @type {Set<string>} */
    this._talkingClients = new Set();
    /** @type {number|null} */
    this._vadInterval = null;
    /** @type {number} */
    this.localMicLevel = 0;

    this._setupListeners();
  }

  /** @private */
  _setupListeners() {}

  /** @private */
  _bindVoiceConsume() {
    this._unbindVoiceConsume();
    const conn = getVoiceConn();
    if (conn) {
      this._voiceConsumeHandler = (e) => this._handleConsume(e.detail);
      conn.addEventListener('voice:consume', this._voiceConsumeHandler);
      this._voiceConsumeConn = conn;
    }
  }

  /** @private */
  _unbindVoiceConsume() {
    if (this._voiceConsumeConn && this._voiceConsumeHandler) {
      this._voiceConsumeConn.removeEventListener('voice:consume', this._voiceConsumeHandler);
      this._voiceConsumeConn = null;
      this._voiceConsumeHandler = null;
    }
  }

  /**
   * @param {object} routerRtpCapabilities - RTP capabilities from the server router
   */
  async setupDevice(routerRtpCapabilities) {
    log('Loading mediasoup Device...');
    this.device = new Device();
    await this.device.load({ routerRtpCapabilities });
    log('Device loaded, handler:', this.device.handlerName);
  }

  /**
   * @returns {Promise<void>}
   */
  async createTransports() {
    log('Requesting send transport...');
    const conn = getVoiceConn();
    const sendData = await conn.request('voice:create-transport', { direction: 'send' });
    log('Send transport received:', sendData.id, 'ICE candidates:', sendData.iceCandidates?.length);

    this.sendTransport = this.device.createSendTransport({
      id: sendData.id,
      iceParameters: sendData.iceParameters,
      iceCandidates: sendData.iceCandidates,
      dtlsParameters: sendData.dtlsParameters,
    });

    this.sendTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
      log('Send transport connect event');
      getVoiceConn()
        .request('voice:connect-transport', {
          transportId: this.sendTransport.id,
          dtlsParameters,
        })
        .then(() => {
          log('Send transport connected');
          callback();
        })
        .catch((e) => {
          err('Send transport connect failed:', e);
          errback(e);
        });
    });

    this.sendTransport.on('produce', ({ kind, rtpParameters, appData }, callback, errback) => {
      log('Send transport produce event, kind:', kind);
      getVoiceConn()
        .request('voice:produce', {
          transportId: this.sendTransport.id,
          kind,
          rtpParameters,
          appData,
        })
        .then(({ producerId }) => {
          log('Produced:', producerId, 'kind:', kind);
          callback({ id: producerId });
        })
        .catch((e) => {
          err('Produce failed:', e);
          errback(e);
        });
    });

    this.sendTransport.on('connectionstatechange', (state) => {
      log('Send transport connection state:', state);
      if (state === 'connected') {
        log('Send transport CONNECTED - ICE and DTLS completed');
      } else if (state === 'failed' || state === 'disconnected' || state === 'closed') {
        err('Send transport state issue:', state);
      }
    });

    log('Requesting recv transport...');
    const recvData = await conn.request('voice:create-transport', { direction: 'recv' });
    log('Recv transport received:', recvData.id, 'ICE candidates:', recvData.iceCandidates?.length);

    this.recvTransport = this.device.createRecvTransport({
      id: recvData.id,
      iceParameters: recvData.iceParameters,
      iceCandidates: recvData.iceCandidates,
      dtlsParameters: recvData.dtlsParameters,
    });

    this.recvTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
      log('Recv transport connect event');
      getVoiceConn()
        .request('voice:connect-transport', {
          transportId: this.recvTransport.id,
          dtlsParameters,
        })
        .then(() => {
          log('Recv transport connected');
          callback();
        })
        .catch((e) => {
          err('Recv transport connect failed:', e);
          errback(e);
        });
    });

    this.recvTransport.on('connectionstatechange', (state) => {
      log('Recv transport connection state:', state);
      if (state === 'connected') {
        log('Recv transport CONNECTED - ICE and DTLS completed');
      } else if (state === 'failed' || state === 'disconnected' || state === 'closed') {
        err('Recv transport state issue:', state);
      }
    });

    this._bindVoiceConsume();
    log('Both transports created');
  }

  /**
   * @returns {Promise<import('mediasoup-client').Producer>}
   */
  async startMicrophone() {
    if (!this.sendTransport) {
      err('No send transport');
      return;
    }

    const audioConstraints = {};
    if (this.selectedMicId) {
      audioConstraints.deviceId = { exact: this.selectedMicId };
    }
    if (this.noiseSuppression) {
      audioConstraints.noiseSuppression = false;
      audioConstraints.echoCancellation = true;
      audioConstraints.autoGainControl = true;
    }
    const constraints = { audio: Object.keys(audioConstraints).length > 0 ? audioConstraints : true };
    log('getUserMedia with:', JSON.stringify(constraints));

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    const track = stream.getAudioTracks()[0];
    log('Got audio track:', track.label, 'settings:', JSON.stringify(track.getSettings()));

    this._monitorTrack(getVoiceConn()?.clientId, track.clone());

    let producerTrack = track;
    if (this.noiseSuppression) {
      producerTrack = await this._applyNoiseFilter(track);
    }

    this.micProducer = await this.sendTransport.produce({ track: producerTrack });
    log('Mic producer created:', this.micProducer.id);

    this.micProducer.on('transportclose', () => {
      log('Mic producer closed (transport closed)');
      this.micProducer = null;
    });

    this.micProducer.on('trackended', () => {
      log('Mic track ended');
    });

    if (this._manualMute || this._deafened) {
      this.micProducer.pause();
      log('Mic paused (restoring mute state after channel switch)');
    }
    this._broadcastMuteState();

    return this.micProducer;
  }

  /**
   * @returns {void}
   */
  stopMicrophone() {
    if (this.micProducer) {
      log('Stopping microphone producer:', this.micProducer.id);
      this.micProducer.close();
      this.micProducer = null;
    }
    if (this._noiseFilterNodes) {
      this._noiseFilterNodes.source.disconnect();
      this._noiseFilterNodes.highpass.disconnect();
      this._noiseFilterNodes.highpass2.disconnect();
      if (this._noiseFilterNodes.workletNode) {
        this._noiseFilterNodes.workletNode.port.postMessage({ type: 'destroy' });
        this._noiseFilterNodes.workletNode.disconnect();
      }
      this._noiseFilterNodes.originalTrack.stop();
      this._noiseFilterNodes = null;
    }
    this._stopMonitorTrack(getVoiceConn()?.clientId);
  }

  /**
   * @returns {Promise<import('mediasoup-client').Producer>}
   */
  async startWebcam() {
    if (!this.sendTransport) {
      err('No send transport');
      return;
    }

    const videoConstraints = {};
    if (this.selectedCameraId) {
      videoConstraints.deviceId = { exact: this.selectedCameraId };
    }
    const constraints = { video: Object.keys(videoConstraints).length > 0 ? videoConstraints : true };
    log('Webcam getUserMedia with:', JSON.stringify(constraints));

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    const track = stream.getVideoTracks()[0];
    log('Got webcam track:', track.label);

    this.webcamProducer = await this.sendTransport.produce({
      track,
      appData: { webcam: true },
    });
    log('Webcam producer created:', this.webcamProducer.id);

    this.webcamProducer.on('transportclose', () => {
      log('Webcam producer closed (transport closed)');
      this.webcamProducer = null;
    });

    this.webcamProducer.on('trackended', () => {
      log('Webcam track ended');
      this.stopWebcam();
    });

    getVoiceConn()?.send('webcam:start', {});
    this.dispatchEvent(new CustomEvent('webcam-started', { detail: { track } }));
    return this.webcamProducer;
  }

  /**
   * @returns {void}
   */
  stopWebcam() {
    if (!this.webcamProducer) {
      return;
    }
    log('Stopping webcam producer:', this.webcamProducer.id);
    const track = this.webcamProducer.track;
    this.webcamProducer.close();
    this.webcamProducer = null;
    if (track) {
      track.stop();
    }
    getVoiceConn()?.send('webcam:stop', {});
    this.dispatchEvent(new CustomEvent('webcam-stopped'));
  }

  /**
   * @returns {boolean} Whether the mic is now muted
   */
  toggleMute() {
    if (!this.micProducer) {
      return false;
    }

    if (this.pushToTalkEnabled) {
      this.setPushToTalk(false);
      this._manualMute = false;
      if (!this._deafened) {
        this.micProducer.resume();
        log('Mic unmuted (PTT disabled)');
      }
      this._broadcastMuteState();
      this.dispatchEvent(
        new CustomEvent('mute-changed', {
          detail: { muted: this._manualMute },
        }),
      );
      return this._manualMute;
    }

    this._manualMute = !this._manualMute;
    if (this._manualMute) {
      this.micProducer.pause();
      log('Mic muted');
    } else if (!this._deafened) {
      this.micProducer.resume();
      log('Mic unmuted');
    }
    this._broadcastMuteState();
    this.dispatchEvent(
      new CustomEvent('mute-changed', {
        detail: { muted: this._manualMute },
      }),
    );
    return this._manualMute;
  }

  /**
   * @returns {boolean} Whether the user is now deafened
   */
  toggleDeafen() {
    this._deafened = !this._deafened;
    log('Deafen:', this._deafened);

    if (this._deafened) {
      if (this.micProducer && !this.micProducer.paused) {
        this.micProducer.pause();
        log('Mic paused by deafen');
      }
    } else {
      if (this.micProducer && !this._manualMute) {
        this.micProducer.resume();
        log('Mic resumed after undeafen');
      }
    }

    this._broadcastMuteState();
    this.dispatchEvent(
      new CustomEvent('deafen-changed', {
        detail: { deafened: this._deafened },
      }),
    );

    return this._deafened;
  }

  /** @private */
  _broadcastMuteState() {
    getVoiceConn()?.send('voice:mute-state', {
      muted: this._manualMute || this._deafened,
      deafened: this._deafened,
    });
  }

  /** @returns {boolean} */
  get isDeafened() {
    return this._deafened;
  }

  /**
   * @param {boolean} enabled
   * @param {string} [key=' ']
   */
  setPushToTalk(enabled, key = ' ') {
    const wasEnabled = this.pushToTalkEnabled;
    this.pushToTalkEnabled = enabled;
    this.pushToTalkKey = key;
    log(`Push-to-talk: ${enabled ? 'enabled' : 'disabled'}, key: "${key}"`);

    if (enabled && this.micProducer && !this._deafened) {
      this._manualMute = true;
      this.micProducer.pause();
      this._broadcastMuteState();
    } else if (!enabled && wasEnabled && this.micProducer && !this._deafened) {
      this._manualMute = false;
      this._pttActive = false;
      this.micProducer.resume();
      this._broadcastMuteState();
    }
  }

  /**
   * @returns {void}
   */
  handlePTTKeyDown() {
    if (!this.pushToTalkEnabled || this._deafened || !this.micProducer) {
      return;
    }
    if (this._pttActive) {
      return;
    }

    this._pttActive = true;
    this.micProducer.resume();
    log('PTT: key down, unmuted');
    this.dispatchEvent(new CustomEvent('ptt-changed', { detail: { active: true } }));

    const _myId = getVoiceConn()?.clientId;
    if (_myId && !this._talkingClients.has(_myId)) {
      this._talkingClients.add(_myId);
      this.dispatchEvent(
        new CustomEvent('talking-changed', {
          detail: { clientId: _myId, talking: true },
        }),
      );
    }
  }

  /**
   * @returns {void}
   */
  handlePTTKeyUp() {
    if (!this.pushToTalkEnabled || !this._pttActive) {
      return;
    }

    this._pttActive = false;
    if (this.micProducer) {
      this.micProducer.pause();
    }
    log('PTT: key up, muted');
    this.dispatchEvent(new CustomEvent('ptt-changed', { detail: { active: false } }));

    const _myId2 = getVoiceConn()?.clientId;
    if (_myId2 && this._talkingClients.has(_myId2)) {
      this._talkingClients.delete(_myId2);
      this.dispatchEvent(
        new CustomEvent('talking-changed', {
          detail: { clientId: _myId2, talking: false },
        }),
      );
    }
  }

  /**
   * @private
   * @param {object} data - Consume event data from the server
   */
  async _handleConsume(data) {
    const { consumerId, producerId, kind, rtpParameters, clientId, nickname, screen, screenAudio, webcam } = data;
    log(`Consume request: consumer=${consumerId} producer=${producerId} kind=${kind} screen=${!!screen} screenAudio=${!!screenAudio} webcam=${!!webcam} from=${nickname}`);

    if (!this.recvTransport) {
      err('No recv transport, cannot consume');
      return;
    }

    try {
      const consumer = await this.recvTransport.consume({
        id: consumerId,
        producerId,
        kind,
        rtpParameters,
      });

      this._consumers.set(consumerId, { consumer, clientId, nickname, screen: !!screen, screenAudio: !!screenAudio, webcam: !!webcam });
      log(`Consumer created: ${consumerId} kind=${kind} from=${nickname} track=${consumer.track?.readyState}`);

      if (kind === 'audio' && !screenAudio) {
        this._monitorTrack(clientId, consumer.track.clone());
      }

      consumer.on('producerclose', () => {
        log(`Consumer ${consumerId} producerclose from ${nickname}`);
        this._consumers.delete(consumerId);
        this.dispatchEvent(
          new CustomEvent('consumer-closed', {
            detail: { consumerId, clientId, kind, screen: !!screen, screenAudio: !!screenAudio, webcam: !!webcam },
          }),
        );
      });

      await getVoiceConn()?.request('voice:consumer-resume', { consumerId });
      log(`Consumer resumed on server: ${consumerId}`);

      this.dispatchEvent(
        new CustomEvent('new-consumer', {
          detail: { consumer, clientId, nickname, kind, screen: !!screen, screenAudio: !!screenAudio, webcam: !!webcam },
        }),
      );
    } catch (e) {
      err('Consume failed:', e);
    }
  }

  /**
   * @returns {Array<{consumerId: string, clientId: string, track: MediaStreamTrack}>}
   */
  getVoiceConsumerTracks() {
    const tracks = [];
    for (const [consumerId, entry] of this._consumers) {
      if (!entry.screenAudio && entry.consumer.kind === 'audio' && entry.consumer.track) {
        tracks.push({ consumerId, clientId: entry.clientId, track: entry.consumer.track });
      }
    }
    return tracks;
  }

  /**
   * @param {string} clientId
   */
  removeConsumersForClient(clientId) {
    for (const [consumerId, entry] of this._consumers) {
      if (entry.clientId === clientId) {
        log(`Removing consumer ${consumerId} for client ${clientId}`);
        entry.consumer.close();
        this._consumers.delete(consumerId);
      }
    }
    this._stopMonitorTrack(clientId);
    this.dispatchEvent(new CustomEvent('consumer-removed', { detail: { clientId } }));
  }

  /**
   * @returns {Promise<{microphones: MediaDeviceInfo[], speakers: MediaDeviceInfo[], cameras: MediaDeviceInfo[]}>}
   */
  async getAudioDevices() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return {
      microphones: devices.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default'),
      speakers: devices.filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'default'),
      cameras: devices.filter((d) => d.kind === 'videoinput' && d.deviceId !== 'default'),
    };
  }

  /**
   * @param {string} deviceId
   */
  setMicrophone(deviceId) {
    this.selectedMicId = deviceId;
    log('Selected microphone:', deviceId);
  }

  /**
   * @param {string} deviceId
   */
  setCamera(deviceId) {
    this.selectedCameraId = deviceId;
    log('Selected camera:', deviceId);
  }

  /**
   * @param {number} level - 0 = disabled, 1-100 = threshold
   */
  setVoiceActivationLevel(level) {
    this.voiceActivationLevel = level;
    log('Voice activation level:', level);
    if (level === 0 && this.micProducer && this.micProducer.paused && !this._manualMute) {
      this.micProducer.resume();
    }
  }

  /**
   * @param {boolean} enabled
   */
  setNoiseSuppression(enabled) {
    this.noiseSuppression = enabled;
    log('Noise suppression:', enabled);
    if (this.micProducer && this.sendTransport) {
      this._restartMicrophone();
    }
  }

  /**
   * @private
   * @returns {Promise<void>}
   */
  async _restartMicrophone() {
    log('Restarting microphone to apply new audio processing settings');
    const wasMuted = this._manualMute;
    const wasDeafened = this._deafened;
    this.stopMicrophone();
    await this.startMicrophone();
    if (wasMuted) {
      this._manualMute = true;
    }
    if (wasDeafened) {
      this._deafened = true;
    }
    if ((wasMuted || wasDeafened) && this.micProducer) {
      this.micProducer.pause();
    }
  }

  /**
   * Apply RNNoise WASM denoiser and high-pass filters to the mic track.
   * Chain: source → highpass 85Hz → highpass 200Hz → RNNoise worklet → destination
   * @private
   * @param {MediaStreamTrack} track
   * @returns {Promise<MediaStreamTrack>}
   */
  async _applyNoiseFilter(track) {
    const ctx = this._getAudioContext();
    const source = ctx.createMediaStreamSource(new MediaStream([track]));

    const highpass = ctx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 85;
    highpass.Q.value = 0.7;

    const highpass2 = ctx.createBiquadFilter();
    highpass2.type = 'highpass';
    highpass2.frequency.value = 200;
    highpass2.Q.value = 0.5;

    const dest = ctx.createMediaStreamDestination();

    let workletNode = null;
    try {
      await ctx.audioWorklet.addModule('worklets/rnnoise-processor.js');

      const wasmPath = '../../node_modules/@jitsi/rnnoise-wasm/dist/rnnoise.wasm';
      const wasmResponse = await fetch(wasmPath);
      const wasmBytes = await wasmResponse.arrayBuffer();
      const wasmModule = await WebAssembly.compile(wasmBytes);

      workletNode = new AudioWorkletNode(ctx, 'rnnoise-processor');
      workletNode.port.postMessage({ type: 'init', wasmModule });

      workletNode.port.onmessage = (e) => {
        if (e.data.type === 'vad') {
          this._rnnoiseVadProb = e.data.value;
        }
      };

      source.connect(highpass);
      highpass.connect(highpass2);
      highpass2.connect(workletNode);
      workletNode.connect(dest);
      log('Noise filter applied: highpass 85Hz + 200Hz + RNNoise WASM');
    } catch (e) {
      err('RNNoise worklet failed, falling back to highpass-only:', e);
      source.connect(highpass);
      highpass.connect(highpass2);
      highpass2.connect(dest);
      log('Noise filter applied: highpass 85Hz + 200Hz (no RNNoise)');
    }

    this._noiseFilterNodes = { source, highpass, highpass2, workletNode, dest, originalTrack: track };

    return dest.stream.getAudioTracks()[0];
  }

  /**
   * @param {string} deviceId
   */
  setSpeaker(deviceId) {
    this.selectedSpeakerId = deviceId;
    log('Selected speaker:', deviceId);
    this.dispatchEvent(new CustomEvent('speaker-changed', { detail: { deviceId } }));
  }

  /**
   * @private
   * @returns {AudioContext}
   */
  _getAudioContext() {
    if (!this._audioContext) {
      this._audioContext = new AudioContext();
    }
    if (this._audioContext.state === 'suspended') {
      this._audioContext.resume().catch(() => {});
    }
    return this._audioContext;
  }

  /**
   * @private
   * @param {string} clientId
   * @param {MediaStreamTrack} track
   */
  _monitorTrack(clientId, track) {
    this._stopMonitorTrack(clientId);
    const ctx = this._getAudioContext();
    const stream = new MediaStream([track]);
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    this._analysers.set(clientId, { analyser, source, track, lastActivity: 0 });
    this._startVADLoop();
  }

  /**
   * @private
   * @param {string} clientId
   */
  _stopMonitorTrack(clientId) {
    const entry = this._analysers.get(clientId);
    if (entry) {
      entry.source.disconnect();
      if (entry.track) {
        entry.track.stop();
      }
      this._analysers.delete(clientId);
      if (this._talkingClients.has(clientId)) {
        this._talkingClients.delete(clientId);
        this.dispatchEvent(
          new CustomEvent('talking-changed', {
            detail: { clientId, talking: false },
          }),
        );
      }
    }
    if (this._analysers.size === 0) {
      this._stopVADLoop();
    }
  }

  /** @private */
  _startVADLoop() {
    if (this._vadInterval) {
      return;
    }
    this._vadInterval = setInterval(() => {
      const now = Date.now();
      const myClientId = getVoiceConn()?.clientId;
      for (const [clientId, entry] of this._analysers) {
        if (myClientId && clientId === myClientId && (this._manualMute || this._deafened) && !this._pttActive) {
          if (this._talkingClients.has(clientId)) {
            this._talkingClients.delete(clientId);
            this.dispatchEvent(
              new CustomEvent('talking-changed', {
                detail: { clientId, talking: false },
              }),
            );
          }
          continue;
        }

        const data = new Uint8Array(entry.analyser.frequencyBinCount);
        entry.analyser.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length;

        if (myClientId && clientId === myClientId) {
          this.localMicLevel = avg;
        }

        if (myClientId && clientId === myClientId && this.voiceActivationLevel > 0 && this.micProducer && !this._manualMute && !this._deafened) {
          if (avg > this.voiceActivationLevel) {
            entry._lastVoiceGate = now;
            if (this.micProducer.paused) {
              this.micProducer.resume();
            }
          } else if (!this.micProducer.paused && now - (entry._lastVoiceGate || 0) > 300) {
            this.micProducer.pause();
          }
        }

        if (myClientId && clientId === myClientId && this._pttActive) {
          continue;
        }

        const isLocal = myClientId && clientId === myClientId;
        const talkThreshold = isLocal && this.voiceActivationLevel > 0 ? this.voiceActivationLevel : 15;

        const wasTalking = this._talkingClients.has(clientId);
        if (avg > talkThreshold) {
          entry.lastActivity = now;
          if (!wasTalking) {
            this._talkingClients.add(clientId);
            this.dispatchEvent(
              new CustomEvent('talking-changed', {
                detail: { clientId, talking: true },
              }),
            );
          }
        } else if (wasTalking && now - entry.lastActivity > 300) {
          this._talkingClients.delete(clientId);
          this.dispatchEvent(
            new CustomEvent('talking-changed', {
              detail: { clientId, talking: false },
            }),
          );
        }
      }
    }, 50);
  }

  /** @private */
  _stopVADLoop() {
    if (this._vadInterval) {
      clearInterval(this._vadInterval);
      this._vadInterval = null;
    }
  }

  /**
   * @param {string} clientId
   * @returns {boolean}
   */
  isTalking(clientId) {
    return this._talkingClients.has(clientId);
  }

  /**
   * @param {string} userId
   * @returns {number}
   */
  getUserVolume(userId) {
    return this._userVolumes.get(userId) ?? 100;
  }

  /**
   * @param {string} userId
   * @param {number} volume - 0-100
   */
  setUserVolume(userId, volume) {
    this._userVolumes.set(userId, volume);
    this.dispatchEvent(new CustomEvent('user-volume-changed', { detail: { userId, volume } }));
  }

  /**
   * @returns {void}
   */
  cleanup() {
    log('Cleanup: stopping all');
    this._unbindVoiceConsume();
    this.stopMicrophone();
    this.stopWebcam();

    for (const { consumer } of this._consumers.values()) {
      consumer.close();
    }
    this._consumers.clear();

    this._stopVADLoop();
    for (const entry of this._analysers.values()) {
      entry.source.disconnect();
    }
    this._analysers.clear();
    this._talkingClients.clear();
    if (this._audioContext) {
      this._audioContext.close();
      this._audioContext = null;
    }

    if (this.sendTransport) {
      this.sendTransport.close();
      this.sendTransport = null;
    }
    if (this.recvTransport) {
      this.recvTransport.close();
      this.recvTransport = null;
    }

    this.device = null;
    this._manualMute = false;
    this._deafened = false;
    this._pttActive = false;
  }
}

const voiceService = new VoiceService();
export default voiceService;
