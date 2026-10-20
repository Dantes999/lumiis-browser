import { describe, expect, it } from 'vitest';
import {
  DIR_COUNT,
  PLAYER_INSET,
  WALK_SPEED,
  WORLD_PIXELS,
  dirFromInput,
  stepPosition,
} from '@lumiis/shared';

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
    const next = stepPosition(WORLD_PIXELS / 2, WORLD_PIXELS / 2, 6, dt);
    expect(next.x).toBeCloseTo(WORLD_PIXELS / 2 + WALK_SPEED * dt, 5);
    expect(next.y).toBeCloseTo(WORLD_PIXELS / 2, 5);
  });

  it('does not move faster on a diagonal', () => {
    const start = { x: WORLD_PIXELS / 2, y: WORLD_PIXELS / 2 };
    const next = stepPosition(start.x, start.y, 7, dt);
    const distance = Math.hypot(next.x - start.x, next.y - start.y);
    expect(distance).toBeCloseTo(WALK_SPEED * dt, 5);
  });

  it('stays inside the world', () => {
    const edge = stepPosition(WORLD_PIXELS - PLAYER_INSET, WORLD_PIXELS / 2, 6, 10);
    expect(edge.x).toBe(WORLD_PIXELS - PLAYER_INSET);

    const corner = stepPosition(0, 0, 3, 10);
    expect(corner.x).toBe(PLAYER_INSET);
    expect(corner.y).toBe(PLAYER_INSET);
  });

  it('is a pure function: same input, same output', () => {
    const first = stepPosition(100, 200, 5, dt);
    const second = stepPosition(100, 200, 5, dt);
    expect(first).toEqual(second);
  });
});
