import { describe, expect, it } from 'vitest';
import { DIR_COUNT, WALK_SPEED, dirFromInput, stepPosition } from '@lumiis/shared';

describe('direction from input', () => {
  it('returns null when nothing is pressed', () => {
    expect(dirFromInput(0, 0)).toBeNull();
  });

  it('maps the four cardinal directions', () => {
    expect(dirFromInput(0, 1)).toBe(0); // south
    expect(dirFromInput(-1, 0)).toBe(2); // west
    expect(dirFromInput(0, -1)).toBe(4); // north
    expect(dirFromInput(1, 0)).toBe(6); // east
  });

  it('maps the four diagonals', () => {
    expect(dirFromInput(-1, 1)).toBe(1);
    expect(dirFromInput(-1, -1)).toBe(3);
    expect(dirFromInput(1, -1)).toBe(5);
    expect(dirFromInput(1, 1)).toBe(7);
  });

  it('clamps values outside -1..1 instead of inventing a direction', () => {
    expect(dirFromInput(5, 0)).toBe(6);
    expect(dirFromInput(-9, 9)).toBe(1);
  });

  it('always returns a direction that exists', () => {
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const dir = dirFromInput(dx, dy);
        if (dir === null) continue;
        expect(dir).toBeGreaterThanOrEqual(0);
        expect(dir).toBeLessThan(DIR_COUNT);
      }
    }
  });
});

describe('stepping a position', () => {
  const dt = 1 / 20;

  it('moves exactly speed times time in a cardinal direction', () => {
    const next = stepPosition(100, 100, 6, dt);
    expect(next.x).toBeCloseTo(100 + WALK_SPEED * dt, 5);
    expect(next.y).toBeCloseTo(100, 5);
  });

  it('does not move faster on a diagonal', () => {
    const next = stepPosition(100, 100, 7, dt);
    expect(Math.hypot(next.x - 100, next.y - 100)).toBeCloseTo(WALK_SPEED * dt, 5);
  });

  it('does not clamp: the map decides where the ground ends', () => {
    expect(stepPosition(5, 5, 2, dt).x).toBeLessThan(5);
    expect(stepPosition(5, 5, 4, dt).y).toBeLessThan(5);
  });

  it('is a pure function: same input, same output', () => {
    expect(stepPosition(100, 200, 5, dt)).toEqual(stepPosition(100, 200, 5, dt));
  });
});
