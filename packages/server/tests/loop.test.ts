import { describe, expect, it } from 'vitest';
import { FixedStepLoop } from '../src/game/loop.js';

const createLoop = (maxCatchUpTicks?: number) => {
  let now = 0;
  const ticks: number[] = [];
  const loop = new FixedStepLoop(
    50,
    (tick) => ticks.push(tick),
    () => now,
    maxCatchUpTicks,
  );
  return {
    ticks,
    loop,
    advanceTo(ms: number): void {
      now = ms;
    },
  };
};

describe('fixed step loop', () => {
  it('does not tick before one full tick has passed', () => {
    const { loop, advanceTo } = createLoop();
    advanceTo(49);
    expect(loop.pump()).toBe(0);
  });

  it('runs exactly one tick after one tick duration', () => {
    const { loop, ticks, advanceTo } = createLoop();
    advanceTo(50);
    expect(loop.pump()).toBe(1);
    expect(ticks).toEqual([1]);
    expect(loop.tick).toBe(1);
  });

  it('catches up missed ticks without speeding up', () => {
    const { loop, advanceTo } = createLoop();
    advanceTo(50);
    loop.pump();

    advanceTo(200);
    expect(loop.pump()).toBe(3);
    expect(loop.tick).toBe(4);
  });

  it('drops the backlog instead of spiralling when it falls far behind', () => {
    const { loop, ticks, advanceTo } = createLoop(2);
    advanceTo(5000);
    expect(loop.pump()).toBe(2);
    expect(ticks).toEqual([1, 2]);

    // The backlog is gone: the next tick is a normal one, not another burst.
    advanceTo(5050);
    expect(loop.pump()).toBe(1);
  });

  it('keeps tick numbers increasing by one', () => {
    const { loop, ticks, advanceTo } = createLoop();
    for (let ms = 50; ms <= 500; ms += 50) {
      advanceTo(ms);
      loop.pump();
    }
    expect(ticks).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});
