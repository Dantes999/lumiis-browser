// Aiming with the mouse.
//
// With "Aim at mouse" on, the swing goes towards the pointer instead of the
// walking direction, and an arrow under the player shows where it will land.
// The pointer is tracked in world pixels by the scene; this file only stores it
// and turns it into one of the eight directions the game understands.

import { dirFromInput, type Direction } from '@lumiis/shared';
import { view } from './state';

let enabled = false;
let pointer: { x: number; y: number } | null = null;
/** Direction pushed on the touch attack stick, null when not pushed. */
let stick: Direction | null = null;

export const setAimEnabled = (on: boolean): void => {
  enabled = on;
};

export const isAimEnabled = (): boolean => enabled;

/** Called by the scene whenever the mouse moves over the map. */
export const setAimPointer = (x: number, y: number): void => {
  pointer = { x, y };
};

/** Sets the direction of the on-screen attack stick (null releases it). */
export const setStickAim = (dir: Direction | null): void => {
  stick = dir;
};

/** The direction the attack stick is pushed to, or null. */
export const stickAimDirection = (): Direction | null => stick;

/** The eight-way direction from the player to the pointer, or null. */
export const aimDirection = (): Direction | null => {
  if (!enabled || pointer === null) return null;
  return dirFromInput(pointer.x - view.self.x, pointer.y - view.self.y);
};

/** The pointer in world pixels while aiming, for the ground arrow. */
export const aimPoint = (): { x: number; y: number } | null => (enabled ? pointer : null);
