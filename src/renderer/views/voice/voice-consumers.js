/**
 * Factory that creates consumer management handlers for mediasoup audio/video consumers.
 * Manages audio playback, webcam tiles, and screen share consumers.
 *
 * @param {object} deps - Dependencies from the voice view module
 * @param {Map} deps.audioElements - Map of consumerId to audio entry objects
 * @param {Map} deps.webcamConsumers - Map of clientId to webcam consumer info
 * @param {Map} deps.screenVideoConsumers - Map of clientId to screen video consumer info
 * @param {Map} deps.clientUserMap - Map of clientId to userId for persistent identity
 * @param {Function} deps.getIsDeafened - Returns current deafened state
 * @param {Function} deps.getScreenAudioGain - Returns current screen audio gain (0-100)
 * @param {Function} deps.getWatchingScreenClientId - Returns clientId of currently watched screen
 * @param {Function} deps.log - Logging function
 * @param {object} deps.voiceService - Voice service for speaker/volume state
 * @param {HTMLElement} deps.screenVolumeControl - Screen volume control DOM element
 * @param {Function} deps.createWebcamTile - Creates a webcam tile in the media grid
 * @param {Function} deps.removeWebcamTile - Removes a webcam tile from the media grid
 * @param {Function} deps.createScreenTile - Creates a screen share tile in the media grid
 * @param {Function} deps.removeScreenTile - Removes a screen share tile from the media grid
 * @param {Function} deps.unwatchScreen - Stops watching a screen share
 * @param {Function} deps.backToGrid - Returns to the media grid view
 * @returns {object} Object containing consumer handler functions
 */
export function createConsumerHandlers(deps) {
  const {
    audioElements,
    webcamConsumers,
    screenVideoConsumers,
    clientUserMap,
    getIsDeafened,
    getScreenAudioGain,
    getWatchingScreenClientId,
    log,
    voiceService,
    screenVolumeControl,
    createWebcamTile,
    removeWebcamTile,
    createScreenTile,
    removeScreenTile,
    unwatchScreen,
    backToGrid
  } = deps;

  /**
   * Cleans up resources associated with an audio consumer entry.
   * Closes AudioContext for screen audio or removes the audio element for voice audio.
   *
   * @param {string} consumerId - The mediasoup consumer ID
   * @param {object} entry - The audio entry containing audio element or AudioContext
   * @returns {void}
   */
  function cleanupAudioEntry(consumerId, entry) {
    if (entry.audioCtx) {
      entry.audioCtx.close().catch(() => {});
    }
    if (entry.audio) {
      entry.audio.srcObject = null;
      entry.audio.remove();
    }
    audioElements.delete(consumerId);
  }

  /**
   * Handles a new mediasoup consumer event. Routes the consumer to the appropriate
   * handler based on its kind (audio/video) and type (voice, screen, webcam, screenAudio).
   *
   * @param {CustomEvent} e - Event with detail containing consumer, clientId, nickname, kind, screen, screenAudio, webcam
   * @returns {Promise<void>}
   */
  async function onNewConsumer(e) {
    const { consumer, clientId, nickname, kind, screen, screenAudio, webcam } = e.detail;
    log(`New consumer: kind=${kind} screen=${!!screen} webcam=${!!webcam} screenAudio=${!!screenAudio} from=${nickname} (${clientId})`);

    if (kind === 'video' && webcam) {
      webcamConsumers.set(clientId, { consumer, nickname });
      createWebcamTile(clientId, nickname, consumer.track, false);
      return;
    }

    if (kind === 'video' && screen) {
      const track = consumer.track;
      screenVideoConsumers.set(clientId, { consumer, nickname, track });
      log('Screen video consumer from', nickname);
      createScreenTile(clientId, nickname, track, false);
      return;
    }

    if (kind === 'audio' && screenAudio) {
      const track = consumer.track;
      const stream = new MediaStream([track]);

      const audioCtx = new AudioContext();
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
      }

      const source = audioCtx.createMediaStreamSource(stream);
      const gainNode = audioCtx.createGain();
      gainNode.gain.setValueAtTime(getScreenAudioGain() / 100, audioCtx.currentTime);
      source.connect(gainNode);
      gainNode.connect(audioCtx.destination);

      if (voiceService.selectedSpeakerId) {
        try {
          if (typeof audioCtx.setSinkId === 'function') {
            await audioCtx.setSinkId(voiceService.selectedSpeakerId);
          }
        } catch (err) {
          log(`Failed to set screen audio output device:`, err.message);
        }
      }

      if (getIsDeafened()) {
        gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
      }

      audioElements.set(consumer.id, { clientId, track, screenAudio: true, audioCtx, gainNode, source });

      const watchingId = getWatchingScreenClientId();
      if (watchingId && watchingId !== '__local__') {
        screenVolumeControl.classList.remove('hidden');
      }
      return;
    }

    if (kind === 'audio' && !screenAudio) {
      const track = consumer.track;
      const audio = new Audio();
      audio.volume = 1.0;

      const userId = clientUserMap.get(clientId);
      if (userId) {
        const vol = voiceService.getUserVolume(userId);
        if (vol !== 100) {
          audio.volume = Math.min(vol / 100, 1.0);
        }
      }

      if (voiceService.selectedSpeakerId && typeof audio.setSinkId === 'function') {
        try {
          await audio.setSinkId(voiceService.selectedSpeakerId);
        } catch (err) {
          log(`Failed to set audio output device:`, err.message);
        }
      }

      if (getIsDeafened()) {
        audio.muted = true;
      }

      const origVolume = audio.volume;
      audio.volume = 0;
      audio.srcObject = new MediaStream([track]);
      audio.autoplay = true;
      document.body.appendChild(audio);
      audioElements.set(consumer.id, { audio, clientId, track });
      setTimeout(() => {
        audio.volume = origVolume;
      }, 150);
    }
  }

  /**
   * Handles removal of all consumers for a given client.
   * Cleans up audio elements, webcam tiles, and screen tiles associated with the client.
   *
   * @param {CustomEvent} e - Event with detail containing clientId
   * @returns {void}
   */
  function onConsumerRemoved(e) {
    const { clientId } = e.detail;
    for (const [consumerId, entry] of audioElements) {
      if (entry.clientId === clientId) {
        cleanupAudioEntry(consumerId, entry);
      }
    }
    if (webcamConsumers.has(clientId)) {
      webcamConsumers.delete(clientId);
      removeWebcamTile(clientId);
    }
    if (screenVideoConsumers.has(clientId)) {
      screenVideoConsumers.delete(clientId);
      removeScreenTile(clientId);
      if (getWatchingScreenClientId() === clientId) {
        unwatchScreen();
        backToGrid();
      }
    }
  }

  /**
   * Handles closure of a specific consumer by its ID.
   * Cleans up the corresponding audio entry, webcam tile, or screen tile.
   *
   * @param {CustomEvent} e - Event with detail containing consumerId, clientId, kind, screen, webcam
   * @returns {void}
   */
  function onConsumerClosed(e) {
    const { consumerId, clientId, kind, screen, webcam } = e.detail;
    const entry = audioElements.get(consumerId);
    if (entry) {
      cleanupAudioEntry(consumerId, entry);
    }
    if (kind === 'video' && webcam && webcamConsumers.has(clientId)) {
      webcamConsumers.delete(clientId);
      removeWebcamTile(clientId);
    }
    if (kind === 'video' && screen && screenVideoConsumers.has(clientId)) {
      screenVideoConsumers.delete(clientId);
      removeScreenTile(clientId);
      if (getWatchingScreenClientId() === clientId) {
        unwatchScreen();
        backToGrid();
      }
    }
  }

  /**
   * Handles speaker output device change by updating all active audio consumers
   * to use the newly selected output device.
   *
   * @param {CustomEvent} e - Event with detail containing deviceId
   * @returns {Promise<void>}
   */
  async function onSpeakerChanged(e) {
    const { deviceId } = e.detail;
    log(`Speaker changed to: ${deviceId || 'default'}`);

    for (const [consumerId, entry] of audioElements) {
      try {
        if (entry.audioCtx && typeof entry.audioCtx.setSinkId === 'function') {
          await entry.audioCtx.setSinkId(deviceId || '');
          log(`Updated audio output (AudioContext) for consumer ${consumerId}`);
        } else if (typeof entry.audio.setSinkId === 'function') {
          await entry.audio.setSinkId(deviceId || '');
          log(`Updated audio output for consumer ${consumerId}`);
        }
      } catch (err) {
        log(`Failed to update audio output for consumer ${consumerId}:`, err.message);
      }
    }
  }

  /**
   * Handles per-user volume changes by adjusting gain or volume on all
   * non-screen audio elements belonging to the specified user.
   *
   * @param {CustomEvent} e - Event with detail containing userId and volume (0-100)
   * @returns {void}
   */
  function onUserVolumeChanged(e) {
    const { userId, volume } = e.detail;
    for (const entry of audioElements.values()) {
      if (!entry.screenAudio && clientUserMap.get(entry.clientId) === userId) {
        if (entry.gainNode) {
          entry.gainNode.gain.value = volume / 100;
        } else {
          entry.audio.volume = Math.min(volume / 100, 1.0);
        }
      }
    }
  }

  return {
    onNewConsumer,
    cleanupAudioEntry,
    onConsumerRemoved,
    onConsumerClosed,
    onSpeakerChanged,
    onUserVolumeChanged
  };
}
