// How a swing works.
//
// A hit is not applied when the button is pressed: the arm goes out, and the
// blade connects half way through. Only what stands inside the arc at that
// moment is hit, which is what makes a hit feel like a hit.

import { TICK_MS } from './constants.js';
import { dirFromInput, DIR_VECTORS, type Direction } from './movement.js';
import { itemDef, type ItemKey } from './items.js';

export type SwingArt = 'fist' | 'schwert' | 'zweihand';

export type SwingProfile = {
  art: SwingArt;
  /** Length of the whole swing, in ticks. */
  ticks: number;
  /** Tick inside the swing at which the blow lands. */
  hitAt: number;
  /** Reach in pixels, measured at the feet. */
  range: number;
};

/**
 * One-handed weapons are quick; a two-handed sword is slower and reaches
 * further. Every swing hits everything that stands inside its arc.
 */
export const SWINGS: Record<SwingArt, SwingProfile> = {
  fist: { art: 'fist', ticks: 10, hitAt: 5, range: 34 },
  schwert: { art: 'schwert', ticks: 12, hitAt: 6, range: 44 },
  zweihand: { art: 'zweihand', ticks: 16, hitAt: 9, range: 54 },
};

/** Half the opening angle of the swing: 60 degrees to each side. */
export const SWING_ARC = Math.PI / 3;

/** The swing a weapon of this item produces. */
export function swingFor(weapon: ItemKey | null): SwingProfile {
  const art = (weapon === null ? 'fist' : (itemDef(weapon).weaponArt ?? 'fist')) as SwingArt;
  return SWINGS[art] ?? SWINGS.fist;
}

/** How long the swing lasts on screen, in milliseconds. */
export const swingMs = (profile: SwingProfile): number => profile.ticks * TICK_MS;

/** Turns the body towards a point; keeps the current facing when standing on it. */
export function facingTowards(
  from: { x: number; y: number },
  to: { x: number; y: number },
  fallback: Direction,
): Direction {
  return dirFromInput(to.x - from.x, to.y - from.y) ?? fallback;
}

/** True when the target stands inside the arc of a swing. */
export function inSwingArc(
  origin: { x: number; y: number },
  dir: Direction,
  target: { x: number; y: number },
  range: number,
): boolean {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const distance = Math.hypot(dx, dy);

  if (distance > range) return false;
  // Standing on top of each other: there is no meaningful angle.
  if (distance < 8) return true;

  const vector = DIR_VECTORS[dir];
  if (vector === undefined) return false;

  const length = Math.hypot(vector[0], vector[1]);
  const cosine = (dx * vector[0] + dy * vector[1]) / (distance * length);

  return cosine >= Math.cos(SWING_ARC);
}
