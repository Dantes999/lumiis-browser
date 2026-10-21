import { beforeEach, describe, expect, it } from 'vitest';
import { TILE, TICK_MS, WALK_SPEED, type MapData } from '@lumiis/shared';
import { view } from '../src/state';
import { setWorldMap } from '../src/world-map';
import {
  applyServerPosition,
  interpolationAlpha,
  renderedSelfPosition,
  resetSimulation,
  stepLocal,
} from '../src/sim';

/** Pixels moved per tick at walking speed. */
const STEP_PX = (WALK_SPEED * TICK_MS) / 1000;

const grassMap: MapData = {
  id: 'test',
  width: 16,
  height: 16,
  spawn: { x: 2, y: 2 },
  tiles: new Array(16 * 16).fill(TILE.GRASS),
  spawns: [],
  portals: [],
};

const place = (x: number, y: number, dir = 6): void => {
  view.self = {
    x,
    y,
    prevX: x,
    prevY: y,
    dir: dir as typeof view.self.dir,
    moving: false,
    offsetX: 0,
    offsetY: 0,
    hp: 100,
    maxHp: 100,
    level: 1,
    exp: 0,
    yang: 0,
    buffs: {},
  };
  resetSimulation();
};

beforeEach(() => {
  setWorldMap(grassMap);
  place(100, 100);
});

describe('local prediction', () => {
  it('draws between the last two steps', () => {
    view.self.prevX = 90;
    view.self.x = 100;
    expect(renderedSelfPosition(0)).toEqual({ x: 90, y: 100 });
    expect(renderedSelfPosition(0.5)).toEqual({ x: 95, y: 100 });
    expect(renderedSelfPosition(1)).toEqual({ x: 100, y: 100 });
  });

  it('keeps the interpolation factor inside 0..1', () => {
    stepLocal(10);
    expect(interpolationAlpha()).toBeGreaterThanOrEqual(0);
    expect(interpolationAlpha()).toBeLessThanOrEqual(1);
  });

  it('steps exactly once per tick, not once per frame', () => {
    view.self.moving = true;

    stepLocal(TICK_MS / 2);
    expect(view.self.x).toBe(100);

    stepLocal(TICK_MS / 2);
    expect(view.self.x).toBeCloseTo(100 + STEP_PX, 5);
  });

  it('draws a continuous position while walking at 60 fps', () => {
    view.self.moving = true;
    const drawn: number[] = [];

    // Warm up past the first step: interpolation always draws the past, so the
    // very first tick has nothing to show yet.
    for (let frame = 0; frame < 5; frame += 1) stepLocal(1000 / 60);

    for (let frame = 0; frame < 30; frame += 1) {
      stepLocal(1000 / 60);
      drawn.push(renderedSelfPosition().x);
    }

    // Every frame moves forward by a similar amount: no frame stands still and
    // then jumps by a whole tick.
    for (let i = 1; i < drawn.length; i += 1) {
      const delta = (drawn[i] ?? 0) - (drawn[i - 1] ?? 0);
      expect(delta).toBeGreaterThan(0);
      expect(delta).toBeLessThan(STEP_PX * 1.2);
    }
  });
});

describe('server correction', () => {
  it('does not move the drawn position when a snapshot arrives', () => {
    const before = renderedSelfPosition(1).x;
    applyServerPosition(94, 100);
    expect(renderedSelfPosition(1).x).toBeCloseTo(before, 5);
  });

  it('ignores differences that are only clock noise', () => {
    applyServerPosition(99.2, 100);
    expect(view.self.offsetX).toBe(0);
    expect(view.self.offsetY).toBe(0);
  });

  it('slides towards the server over a few frames instead of jumping', () => {
    applyServerPosition(94, 100);

    stepLocal(1000 / 60);
    const afterOneFrame = renderedSelfPosition(1).x;
    expect(afterOneFrame).toBeLessThan(100);
    expect(afterOneFrame).toBeGreaterThan(94);

    for (let frame = 0; frame < 30; frame += 1) stepLocal(1000 / 60);
    expect(renderedSelfPosition(1).x).toBeCloseTo(94, 1);
  });

  it('snaps when the difference is a real teleport', () => {
    applyServerPosition(500, 600);
    expect(view.self.x).toBe(500);
    expect(view.self.y).toBe(600);
    expect(view.self.offsetX).toBe(0);
    expect(renderedSelfPosition(0)).toEqual({ x: 500, y: 600 });
  });
});
