import { test } from 'node:test';
import assert from 'node:assert';
import { IDENTITY_VIEW, MAX_ZOOM, containedContentRect, panView, wheelZoomFactor, zoomViewAt } from '../src/renderer/views/voice/screen-zoom.js';

const fullHdLayout = {
  width: 1920,
  height: 1080,
  content: containedContentRect(1920, 1080, 1920, 1080),
};

const letterboxedLayout = {
  width: 1920,
  height: 1200,
  content: containedContentRect(1920, 1200, 1920, 1080),
};

test('contained content rect letterboxes a wider video vertically', () => {
  assert.deepStrictEqual(containedContentRect(1920, 1200, 1920, 1080), { x: 0, y: 60, width: 1920, height: 1080 });
});

test('contained content rect pillarboxes a narrower video horizontally', () => {
  assert.deepStrictEqual(containedContentRect(1920, 1080, 1080, 1080), { x: 420, y: 0, width: 1080, height: 1080 });
});

test('contained content rect fills the element while the video size is unknown', () => {
  assert.deepStrictEqual(containedContentRect(800, 600, 0, 0), { x: 0, y: 0, width: 800, height: 600 });
});

test('scrolling up zooms in and scrolling down zooms out', () => {
  assert.ok(wheelZoomFactor(-100, 0) > 1);
  assert.ok(wheelZoomFactor(100, 0) < 1);
  assert.strictEqual(wheelZoomFactor(0, 0), 1);
});

test('line-based wheel deltas zoom like pixel deltas of the same distance', () => {
  assert.strictEqual(wheelZoomFactor(-3, 1), wheelZoomFactor(-48, 0));
});

test('zooming keeps the point under the cursor in place', () => {
  const cursor = { x: 480, y: 270 };
  const view = zoomViewAt(IDENTITY_VIEW, 2, cursor, fullHdLayout);
  assert.strictEqual(view.scale, 2);
  assert.strictEqual(cursor.x - view.x, (cursor.x - IDENTITY_VIEW.x) * 2);
  assert.strictEqual(cursor.y - view.y, (cursor.y - IDENTITY_VIEW.y) * 2);
});

test('zoom is clamped between 1x and the maximum', () => {
  const center = { x: 960, y: 540 };
  assert.deepStrictEqual(zoomViewAt(IDENTITY_VIEW, 0.5, center, fullHdLayout), IDENTITY_VIEW);
  assert.strictEqual(zoomViewAt(IDENTITY_VIEW, 1000, center, fullHdLayout).scale, MAX_ZOOM);
});

test('zooming back out to 1x restores the untransformed view', () => {
  const zoomed = zoomViewAt(IDENTITY_VIEW, 3, { x: 100, y: 900 }, fullHdLayout);
  assert.deepStrictEqual(zoomViewAt(zoomed, 1 / 3, { x: 1800, y: 50 }, fullHdLayout), IDENTITY_VIEW);
});

test('zooming near an edge does not reveal space outside the video', () => {
  const view = zoomViewAt(IDENTITY_VIEW, 2, { x: 1920, y: 1080 }, fullHdLayout);
  assert.deepStrictEqual(view, { scale: 2, x: -1920, y: -1080 });
});

test('panning stops at the content edges', () => {
  const zoomed = zoomViewAt(IDENTITY_VIEW, 2, { x: 960, y: 540 }, fullHdLayout);
  assert.deepStrictEqual(panView(zoomed, 5000, 5000, fullHdLayout), { scale: 2, x: 0, y: 0 });
  assert.deepStrictEqual(panView(zoomed, -5000, -5000, fullHdLayout), { scale: 2, x: -1920, y: -1080 });
});

test('letterboxed content stays centered on the axis that still fits the screen', () => {
  const view = zoomViewAt(IDENTITY_VIEW, 1.05, { x: 960, y: 100 }, letterboxedLayout);
  const scaledTop = view.y + letterboxedLayout.content.y * view.scale;
  const scaledHeight = letterboxedLayout.content.height * view.scale;
  assert.strictEqual(scaledTop, (letterboxedLayout.height - scaledHeight) / 2);
});

test('letterboxed content can be panned to its edge once it overflows the screen', () => {
  const zoomed = zoomViewAt(IDENTITY_VIEW, 2, { x: 960, y: 600 }, letterboxedLayout);
  const panned = panView(zoomed, 0, 5000, letterboxedLayout);
  assert.strictEqual(panned.y + letterboxedLayout.content.y * panned.scale, 0);
});
