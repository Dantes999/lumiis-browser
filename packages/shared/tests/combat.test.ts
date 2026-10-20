import { describe, expect, it } from 'vitest';
import {
  SWINGS,
  SWING_ARC,
  inSwingArc,
  swingFor,
  swingMs,
  type Direction,
} from '../src/index.js';

const origin = { x: 100, y: 100 };

/** A point at the given distance and angle, measured from east, clockwise. */
const at = (distance: number, degrees: number) => {
  const radians = (degrees * Math.PI) / 180;
  return { x: origin.x + Math.cos(radians) * distance, y: origin.y + Math.sin(radians) * distance };
};

describe('swing profiles', () => {
  it('bare hands are quick and short, a sword a little longer', () => {
    expect(swingFor(null).art).toBe('fist');
    expect(swingFor('wooden_sword').art).toBe('schwert');
    expect(SWINGS.schwert.ticks).toBeGreaterThan(SWINGS.fist.ticks);
    expect(SWINGS.schwert.range).toBeGreaterThan(SWINGS.fist.range);
  });

  it('a two-handed sword is slower and reaches further', () => {
    const two = swingFor('great_sword');
    expect(two.art).toBe('zweihand');
    expect(two.ticks).toBeGreaterThan(SWINGS.schwert.ticks);
    expect(two.range).toBeGreaterThan(SWINGS.schwert.range);
  });

  it('lands the blow after the wind-up, not at the button press', () => {
    for (const profile of Object.values(SWINGS)) {
      expect(profile.hitAt).toBeGreaterThan(0);
      expect(profile.hitAt).toBeLessThan(profile.ticks);
    }
  });

  it('reports the swing length in milliseconds for the client', () => {
    expect(swingMs(SWINGS.fist)).toBe(SWINGS.fist.ticks * 50);
  });
});

describe('the arc of a swing', () => {
  it('hits what stands in front of the body', () => {
    expect(inSwingArc(origin, 6 as Direction, at(30, 0), 44)).toBe(true);
  });

  it('hits slightly off to the side', () => {
    const edge = (SWING_ARC * 180) / Math.PI - 2;
    expect(inSwingArc(origin, 6 as Direction, at(30, edge), 44)).toBe(true);
    expect(inSwingArc(origin, 6 as Direction, at(30, -edge), 44)).toBe(true);
  });

  it('misses what stands beside or behind the body', () => {
    expect(inSwingArc(origin, 6 as Direction, at(30, 90), 44)).toBe(false);
    expect(inSwingArc(origin, 6 as Direction, at(30, 180), 44)).toBe(false);
    expect(inSwingArc(origin, 6 as Direction, at(30, -120), 44)).toBe(false);
  });

  it('misses anything beyond the reach of the weapon', () => {
    expect(inSwingArc(origin, 6 as Direction, at(45, 0), 44)).toBe(false);
    expect(inSwingArc(origin, 6 as Direction, at(43, 0), 44)).toBe(true);
  });

  it('hits a monster standing on the same spot, whatever way the body faces', () => {
    expect(inSwingArc(origin, 6 as Direction, at(4, 0), 44)).toBe(true);
  });

  it('works in every direction', () => {
    // 0 is down, then clockwise, because screen y grows downwards.
    const directions: Array<[Direction, number]> = [
      [0, 90],
      [1, 135],
      [2, 180],
      [3, 225],
      [4, 270],
      [5, 315],
      [6, 0],
      [7, 45],
    ];

    for (const [dir, degrees] of directions) {
      expect(inSwingArc(origin, dir, at(30, degrees), 44)).toBe(true);
    }
  });
});
