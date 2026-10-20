// Camera zoom rules. Pure numbers, so they can be tested without a browser.

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 4;

/** One wheel notch (deltaY 100) changes the zoom by about 14 percent. */
const WHEEL_STRENGTH = 0.0014;

export const clampZoom = (zoom: number): number =>
  Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));

/**
 * Wheel input is exponential: small trackpad movements zoom gently, a full
 * notch zooms noticeably, and zooming in and out by the same amount ends where
 * it started.
 */
export function zoomByWheel(current: number, deltaY: number): number {
  if (!Number.isFinite(deltaY)) return clampZoom(current);
  return clampZoom(current * Math.exp(-deltaY * WHEEL_STRENGTH));
}

/** Pinch: the zoom follows the ratio of the current finger distance. */
export function zoomByPinch(startZoom: number, startDistance: number, distance: number): number {
  if (startDistance <= 0 || !Number.isFinite(distance)) return clampZoom(startZoom);
  return clampZoom(startZoom * (distance / startDistance));
}
