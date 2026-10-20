// Local prediction. Runs the same movement function as the server at the same
// rate, so what you see between snapshots is what the server will decide.
//
// The simulation steps 20 times per second, the screen draws around 60. Drawing
// the raw step position makes the figure hop every third frame, so the drawn
// position is interpolated between the last two steps.
//
// Server corrections are not applied as a jump either: the remaining difference
// is carried in offsetX/offsetY and moved into the position a little each frame,
// so a correction is a short slide instead of a teleport.

import { TICK_MS, moveWithCollision } from '@lumiis/shared';
import { view } from './state';
import { getWorldMap } from './world-map';

const TICK_SECONDS = TICK_MS / 1000;
const MAX_STEPS_PER_FRAME = 5;
/** Time constant of the correction slide, in milliseconds. */
const CORRECTION_TAU_MS = 60;
/** A difference larger than this is a real teleport, not a rounding error. */
const SNAP_DISTANCE = 48;
/** Differences below this are phase noise between two 20 Hz clocks; ignore them. */
const CORRECTION_DEADZONE = 1.5;

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

  slideTowardsServer(deltaMs);
}

function stepOnce(): void {
  const self = view.self;
  self.prevX = self.x;
  self.prevY = self.y;

  // The dead do not walk: the server ignores input, so predicting it would only
  // produce a correction every tick.
  if (self.hp <= 0) {
    self.moving = false;
    return;
  }
  if (!self.moving) return;

  // Without a map there is no ground, so there is nothing to predict.
  const map = getWorldMap();
  if (map === null) return;

  const next = moveWithCollision(map, self.x, self.y, self.dir, TICK_SECONDS);
  self.x = next.x;
  self.y = next.y;
}

/** Moves the remaining server difference into the position, smoothly. */
function slideTowardsServer(deltaMs: number): void {
  const self = view.self;
  if (self.offsetX === 0 && self.offsetY === 0) return;

  const share = 1 - Math.exp(-deltaMs / CORRECTION_TAU_MS);
  const moveX = self.offsetX * share;
  const moveY = self.offsetY * share;

  // Both ends of the interpolation move together, so the drawn position slides
  // without changing shape.
  self.x += moveX;
  self.prevX += moveX;
  self.y += moveY;
  self.prevY += moveY;

  self.offsetX -= moveX;
  self.offsetY -= moveY;
}

/** How far we are into the tick that is currently being drawn, 0..1. */
export function interpolationAlpha(): number {
  return Math.min(1, Math.max(0, accumulator / TICK_MS));
}

/** Where the local player is drawn right now. */
export function renderedSelfPosition(alpha: number = interpolationAlpha()): { x: number; y: number } {
  const self = view.self;
  const t = Math.min(1, Math.max(0, alpha));

  return {
    x: self.prevX + (self.x - self.prevX) * t,
    y: self.prevY + (self.y - self.prevY) * t,
  };
}

/**
 * Takes the server position. The expected difference is at most one tick,
 * because both sides step at the same rate with the same rules; a bigger
 * difference means we really are somewhere else and must snap.
 */
export function applyServerPosition(x: number, y: number): void {
  const self = view.self;
  const errorX = x - self.x;
  const errorY = y - self.y;
  const distance = Math.hypot(errorX, errorY);

  if (distance > SNAP_DISTANCE) {
    self.x = x;
    self.y = y;
    self.prevX = x;
    self.prevY = y;
    self.offsetX = 0;
    self.offsetY = 0;
    return;
  }

  // Two 20 Hz clocks never line up exactly. Correcting that would be a constant
  // little tug on the figure, so small differences are left alone.
  if (distance < CORRECTION_DEADZONE) {
    self.offsetX = 0;
    self.offsetY = 0;
    return;
  }

  self.offsetX = errorX;
  self.offsetY = errorY;
}

/** Test hook: forget any accumulated time between steps. */
export function resetSimulation(): void {
  accumulator = 0;
}
