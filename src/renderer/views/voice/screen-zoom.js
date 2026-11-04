/**
 * @typedef {{ scale: number, x: number, y: number }} ZoomView
 * Scale and translation (in CSS pixels) applied to the video element with a top-left transform origin.
 */

/**
 * @typedef {{ x: number, y: number, width: number, height: number }} Rect
 */

/**
 * @typedef {{ width: number, height: number, content: Rect }} ZoomLayout
 * Size of the untransformed video element and the area the picture occupies inside it.
 */

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 8;
export const IDENTITY_VIEW = Object.freeze({ scale: MIN_ZOOM, x: 0, y: 0 });

const ZOOM_PER_WHEEL_PIXEL = 0.002;
const PIXELS_PER_WHEEL_LINE = 16;
const PIXELS_PER_WHEEL_PAGE = 800;
const DRAG_THRESHOLD_PX = 3;

/**
 * Computes where an `object-fit: contain` video draws its picture inside its element.
 * @param {number} elementWidth - Width of the video element
 * @param {number} elementHeight - Height of the video element
 * @param {number} videoWidth - Intrinsic width of the video, 0 if not known yet
 * @param {number} videoHeight - Intrinsic height of the video, 0 if not known yet
 * @returns {Rect} The picture area in element coordinates
 */
export function containedContentRect(elementWidth, elementHeight, videoWidth, videoHeight) {
  if (!videoWidth || !videoHeight) {
    return { x: 0, y: 0, width: elementWidth, height: elementHeight };
  }
  const fit = Math.min(elementWidth / videoWidth, elementHeight / videoHeight);
  const width = videoWidth * fit;
  const height = videoHeight * fit;
  return { x: (elementWidth - width) / 2, y: (elementHeight - height) / 2, width, height };
}

/**
 * Converts a wheel delta into a multiplicative zoom factor; scrolling up zooms in.
 * @param {number} deltaY - The wheel event's deltaY
 * @param {number} deltaMode - The wheel event's deltaMode (0 pixels, 1 lines, 2 pages)
 * @returns {number} Factor to multiply the current zoom with
 */
export function wheelZoomFactor(deltaY, deltaMode) {
  const pixelsPerUnit = [1, PIXELS_PER_WHEEL_LINE, PIXELS_PER_WHEEL_PAGE][deltaMode] ?? 1;
  return Math.exp(-deltaY * pixelsPerUnit * ZOOM_PER_WHEEL_PIXEL);
}

/**
 * Clamps the translation on one axis so the picture covers the viewport, or centers it while it is smaller.
 * @param {number} offset - Requested translation
 * @param {number} scale - Current zoom
 * @param {number} viewportSize - Element size on this axis
 * @param {number} contentStart - Picture start inside the element on this axis
 * @param {number} contentSize - Picture size on this axis
 * @returns {number} The clamped translation
 */
function clampAxis(offset, scale, viewportSize, contentStart, contentSize) {
  const scaledSize = contentSize * scale;
  if (scaledSize <= viewportSize) {
    return (viewportSize - scaledSize) / 2 - contentStart * scale;
  }
  const highest = 0 - contentStart * scale;
  const lowest = viewportSize - (contentStart + contentSize) * scale;
  return Math.min(highest, Math.max(lowest, offset));
}

/**
 * Clamps a view to the allowed zoom range and keeps the picture inside the viewport.
 * @param {ZoomView} view - The requested view
 * @param {ZoomLayout} layout - Current element and picture geometry
 * @returns {ZoomView} The clamped view
 */
function clampView(view, layout) {
  const scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.scale));
  if (scale === MIN_ZOOM) {
    return IDENTITY_VIEW;
  }
  const { content } = layout;
  return {
    scale,
    x: clampAxis(view.x, scale, layout.width, content.x, content.width),
    y: clampAxis(view.y, scale, layout.height, content.y, content.height),
  };
}

/**
 * Zooms by a factor around a point so the picture under that point stays in place.
 * @param {ZoomView} view - The current view
 * @param {number} factor - Zoom multiplier
 * @param {{ x: number, y: number }} point - Anchor in untransformed element coordinates
 * @param {ZoomLayout} layout - Current element and picture geometry
 * @returns {ZoomView} The new view
 */
export function zoomViewAt(view, factor, point, layout) {
  const scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.scale * factor));
  const ratio = scale / view.scale;
  return clampView({ scale, x: point.x - (point.x - view.x) * ratio, y: point.y - (point.y - view.y) * ratio }, layout);
}

/**
 * Moves a zoomed view by a screen distance.
 * @param {ZoomView} view - The current view
 * @param {number} dx - Horizontal distance in CSS pixels
 * @param {number} dy - Vertical distance in CSS pixels
 * @param {ZoomLayout} layout - Current element and picture geometry
 * @returns {ZoomView} The new view
 */
export function panView(view, dx, dy, layout) {
  return clampView({ scale: view.scale, x: view.x + dx, y: view.y + dy }, layout);
}

/**
 * Adds mouse wheel zoom and drag panning to a video while `isActive` returns true.
 * A click that ends a drag is swallowed so it does not trigger the video's click actions.
 * The zoom resets whenever the video loads a new source.
 * @param {HTMLVideoElement} video - The video to zoom; its offset parent is used as the viewport
 * @param {() => boolean} isActive - Whether zooming is currently allowed
 * @returns {{ reset: () => void, detach: () => void }} Controls to reset the zoom and remove all listeners
 */
export function attachVideoZoom(video, isActive) {
  let view = IDENTITY_VIEW;
  let drag = null;
  let lastPressWasDrag = false;

  const readLayout = () => {
    const width = video.clientWidth;
    const height = video.clientHeight;
    return { width, height, content: containedContentRect(width, height, video.videoWidth, video.videoHeight) };
  };

  const render = () => {
    const zoomed = view.scale > MIN_ZOOM;
    video.style.transformOrigin = zoomed ? '0 0' : '';
    video.style.transform = zoomed ? `translate(${view.x}px, ${view.y}px) scale(${view.scale})` : '';
    video.classList.toggle('zoomed', zoomed);
    video.classList.toggle('panning', drag !== null);
  };

  const setView = (next) => {
    view = next;
    render();
  };

  const onWheel = (e) => {
    if (!isActive()) {
      return;
    }
    e.preventDefault();
    const viewport = video.offsetParent.getBoundingClientRect();
    const point = { x: e.clientX - viewport.left - video.offsetLeft, y: e.clientY - viewport.top - video.offsetTop };
    setView(zoomViewAt(view, wheelZoomFactor(e.deltaY, e.deltaMode), point, readLayout()));
  };

  const onMouseMove = (e) => {
    const dx = e.clientX - drag.lastX;
    const dy = e.clientY - drag.lastY;
    drag.lastX = e.clientX;
    drag.lastY = e.clientY;
    drag.moved ||= Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > DRAG_THRESHOLD_PX;
    setView(panView(view, dx, dy, readLayout()));
  };

  const onMouseUp = () => {
    lastPressWasDrag = drag.moved;
    drag = null;
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
    render();
  };

  const onMouseDown = (e) => {
    lastPressWasDrag = false;
    if (e.button !== 0 || view.scale === MIN_ZOOM || !isActive()) {
      return;
    }
    e.preventDefault();
    drag = { startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastY: e.clientY, moved: false };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    render();
  };

  const swallowClickAfterDrag = (e) => {
    if (lastPressWasDrag) {
      e.stopImmediatePropagation();
    }
  };

  const reclamp = () => setView(clampView(view, readLayout()));

  const reset = () => {
    if (drag) {
      onMouseUp();
    }
    setView(IDENTITY_VIEW);
  };

  video.addEventListener('wheel', onWheel, { passive: false });
  video.addEventListener('mousedown', onMouseDown);
  video.addEventListener('click', swallowClickAfterDrag, true);
  video.addEventListener('dblclick', swallowClickAfterDrag, true);
  video.addEventListener('resize', reclamp);
  video.addEventListener('loadstart', reset);
  const elementResizeObserver = new ResizeObserver(reclamp);
  elementResizeObserver.observe(video);

  const detach = () => {
    reset();
    video.removeEventListener('wheel', onWheel);
    video.removeEventListener('mousedown', onMouseDown);
    video.removeEventListener('click', swallowClickAfterDrag, true);
    video.removeEventListener('dblclick', swallowClickAfterDrag, true);
    video.removeEventListener('resize', reclamp);
    video.removeEventListener('loadstart', reset);
    elementResizeObserver.disconnect();
  };

  return { reset, detach };
}
