// Local prediction. Runs the same movement function as the server at the same
// rate, so what you see between snapshots is what the server will decide.

import { TICK_MS, stepPosition } from '@lumiis/shared';
import { view } from './state';

const TICK_SECONDS = TICK_MS / 1000;
const MAX_STEPS_PER_FRAME = 5;
const CORRECTION_DECAY = 0.82;

let accumulator = 0;

export function stepLocal(deltaMs: number): void {
  accumulator += deltaMs;

  let steps = 0;
  while (accumulator >= TICK_MS && steps < MAX_STEPS_PER_FRAME) {
    accumulator -= TICK_MS;
    steps += 1;
    stepOnce();
  }

  // A background tab that returns after minutes must not replay thousands of ticks.
  if (steps >= MAX_STEPS_PER_FRAME) accumulator = 0;

  view.self.offsetX *= CORRECTION_DECAY;
  view.self.offsetY *= CORRECTION_DECAY;
}

function stepOnce(): void {
  const self = view.self;
  if (!self.moving) return;

  const next = stepPosition(self.x, self.y, self.dir, TICK_SECONDS);
  self.x = next.x;
  self.y = next.y;
}
