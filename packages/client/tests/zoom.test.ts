import { describe, expect, it } from 'vitest';
import { ZOOM_MAX, ZOOM_MIN, clampZoom, zoomByPinch, zoomByWheel } from '../src/zoom';

describe('camera zoom', () => {
  it('stays inside the allowed range', () => {
    expect(clampZoom(0.2)).toBe(ZOOM_MIN);
    expect(clampZoom(9)).toBe(ZOOM_MAX);
    expect(clampZoom(2.5)).toBe(2.5);
  });

  it('zooms in when the wheel turns up and out when it turns down', () => {
    expect(zoomByWheel(1, -100)).toBeGreaterThan(1);
    expect(zoomByWheel(2, 100)).toBeLessThan(2);
  });

  it('returns to the same zoom when scrolling back', () => {
    const zoomedIn = zoomByWheel(1.5, -100);
    expect(zoomByWheel(zoomedIn, 100)).toBeCloseTo(1.5, 5);
  });

  it('never leaves the range, however far the wheel turns', () => {
    let zoom = 1;
    for (let notch = 0; notch < 50; notch += 1) zoom = zoomByWheel(zoom, -100);
    expect(zoom).toBe(ZOOM_MAX);

    for (let notch = 0; notch < 50; notch += 1) zoom = zoomByWheel(zoom, 100);
    expect(zoom).toBe(ZOOM_MIN);
  });

  it('ignores a broken wheel delta', () => {
    expect(zoomByWheel(2, Number.NaN)).toBe(2);
  });

  it('follows the ratio of a pinch', () => {
    expect(zoomByPinch(1, 100, 200)).toBe(2);
    expect(zoomByPinch(2, 200, 100)).toBe(1);
    expect(zoomByPinch(1, 100, 50)).toBe(ZOOM_MIN);
  });

  it('does not divide by a zero finger distance', () => {
    expect(zoomByPinch(1.5, 0, 100)).toBe(1.5);
  });
});
