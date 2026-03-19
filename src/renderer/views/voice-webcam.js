import voiceService from '../services/voice.js';
import serverService from '../services/server.js';
import { customAlert, customConfirm } from '../services/dialogs.js';

const selfPreview = document.getElementById('self-webcam-preview');
const selfPreviewVideo = document.getElementById('self-webcam-preview-video');
const selfPreviewResizeHandle = document.getElementById('self-webcam-preview-resize');
const btnWebcam = document.getElementById('btn-webcam');
const mediaGrid = document.getElementById('media-grid');

/**
 * Creates webcam and self-preview handler functions bound to shared voice view state.
 * @param {Object} deps - Shared dependencies from the voice view module
 * @param {Function} deps.log - Logger function
 * @param {Function} deps.updateMediaGridVisibility - Toggles media grid visibility based on children
 * @param {Function} deps.playScreenSound - Plays a feedback sound
 * @param {Function} deps.createWebcamTile - Creates a webcam tile in the media grid
 * @param {Function} deps.removeWebcamTile - Removes a webcam tile from the media grid
 * @param {Function} deps.cleanupWcPopout - Cleans up the webcam popout window
 * @param {Function} deps.getState - Returns mutable state object with isWebcamOn, webcamConsumers, focusMode, wcPopoutClientId
 * @returns {Object} Handler functions for webcam UI and self-preview drag/resize
 */
export default function createWebcamHandlers(deps) {
  const {
    log,
    updateMediaGridVisibility,
    playScreenSound,
    createWebcamTile,
    removeWebcamTile,
    cleanupWcPopout,
    getState,
  } = deps;

  /**
   * Handles webcam button click to toggle webcam on/off.
   * Prompts for confirmation before starting.
   * @returns {Promise<void>}
   */
  async function handleWebcamClick() {
    const state = getState();
    if (state.isWebcamOn) {
      voiceService.stopWebcam();
      return;
    }

    if (!(await customConfirm('Do you want to share your webcam?'))) {
      return;
    }

    try {
      await voiceService.startWebcam();
    } catch (err) {
      console.error('Webcam start failed:', err);
      if (err.name !== 'NotAllowedError') {
        await customAlert('Failed to start webcam: ' + err.message);
      }
    }
  }

  /**
   * Handles the local webcam started event. Updates UI state, plays sound,
   * creates a webcam tile, and shows self-preview.
   * @param {CustomEvent} e - Event with detail.track containing the video track
   * @returns {void}
   */
  function onLocalWebcamStarted(e) {
    const state = getState();
    state.isWebcamOn = true;
    btnWebcam.classList.add('active');
    playScreenSound('webcamStart');
    const { track } = e.detail;
    createWebcamTile(serverService.clientId, 'You', track, true);
    selfPreviewVideo.srcObject = new MediaStream([track]);
    updateSelfPreviewVisibility();
  }

  /**
   * Handles a peer webcam stopped event. Removes the peer's webcam consumer
   * and tile from the grid.
   * @param {CustomEvent} e - Event with detail.clientId of the peer
   * @returns {void}
   */
  function onPeerWebcamStopped(e) {
    const { clientId } = e.detail;
    const state = getState();
    log('Peer webcam stopped (server event):', clientId);
    if (state.webcamConsumers.has(clientId)) {
      state.webcamConsumers.delete(clientId);
      removeWebcamTile(clientId);
    }
  }

  /**
   * Handles local webcam stopped. Resets UI state, plays sound, removes tile,
   * and hides self-preview.
   * @returns {void}
   */
  function onLocalWebcamStopped() {
    const state = getState();
    state.isWebcamOn = false;
    btnWebcam.classList.remove('active');
    playScreenSound('webcamStop');
    if (state.wcPopoutClientId === serverService.clientId) {
      cleanupWcPopout();
    }
    removeWebcamTile(serverService.clientId);
    selfPreviewVideo.srcObject = null;
    updateSelfPreviewVisibility();
  }

  /**
   * Initializes drag-to-reposition and corner-resize behavior on the
   * self webcam preview element.
   * @returns {void}
   */
  function initSelfPreviewDrag() {
    let dragStartX = 0;
    let dragStartY = 0;
    let origRight = 0;
    let origBottom = 0;

    selfPreview.addEventListener('mousedown', (e) => {
      if (e.target === selfPreviewResizeHandle) {
        return;
      }
      e.preventDefault();
      const rect = selfPreview.getBoundingClientRect();
      origRight = window.innerWidth - rect.right;
      origBottom = window.innerHeight - rect.bottom;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      selfPreview.classList.add('dragging');

      /**
       * @param {MouseEvent} mv
       */
      function onMove(mv) {
        const dx = mv.clientX - dragStartX;
        const dy = mv.clientY - dragStartY;
        const newRight = Math.max(0, origRight - dx);
        const newBottom = Math.max(0, origBottom - dy);
        selfPreview.style.right = `${newRight}px`;
        selfPreview.style.bottom = `${newBottom}px`;
      }

      /**
       * @returns {void}
       */
      function onUp() {
        selfPreview.classList.remove('dragging');
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      }

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });

    selfPreviewResizeHandle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startY = e.clientY;
      const startWidth = selfPreview.offsetWidth;
      const startHeight = selfPreview.offsetHeight;
      const rect = selfPreview.getBoundingClientRect();
      const startRight = window.innerWidth - rect.right;
      const startBottom = window.innerHeight - rect.bottom;

      /**
       * @param {MouseEvent} mv
       */
      function onMove(mv) {
        const dx = mv.clientX - startX;
        const dy = mv.clientY - startY;
        const newWidth = Math.max(100, startWidth - dx);
        selfPreview.style.width = `${newWidth}px`;
        selfPreview.style.height = `${newWidth * (9 / 16)}px`;
        selfPreview.style.right = `${startRight}px`;
        selfPreview.style.bottom = `${startBottom}px`;
      }

      /**
       * @returns {void}
       */
      function onUp() {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      }

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
  }

  /**
   * Shows or hides the self-preview based on webcam state and current focus mode.
   * Hidden when the user's own webcam is focused in the viewer, visible otherwise
   * when webcam is active.
   * @returns {void}
   */
  function updateSelfPreviewVisibility() {
    const state = getState();
    if (!state.isWebcamOn) {
      selfPreview.classList.add('hidden');
      return;
    }
    const ownFocused = state.focusMode && state.focusMode.type === 'webcam' && state.focusMode.clientId === serverService.clientId;
    selfPreview.classList.toggle('hidden', ownFocused);
  }

  /**
   * Moves the self-preview element into the active fullscreen container so it
   * remains visible on top of the fullscreen video. When fullscreen exits, it is
   * moved back to document.body.
   * @returns {void}
   */
  function repositionSelfPreviewForFullscreen() {
    const fsElement = document.fullscreenElement;
    if (fsElement) {
      fsElement.appendChild(selfPreview);
    } else {
      document.body.appendChild(selfPreview);
    }
  }

  initSelfPreviewDrag();

  return {
    handleWebcamClick,
    onLocalWebcamStarted,
    onPeerWebcamStopped,
    onLocalWebcamStopped,
    initSelfPreviewDrag,
    updateSelfPreviewVisibility,
    repositionSelfPreviewForFullscreen,
  };
}
