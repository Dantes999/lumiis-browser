// Client-side skill state: when a skill was last cast, and how the cooldown
// looks on the buttons. The server is the real judge; this only stops the
// client from spamming and drives the cooldown overlay.

import { SKILLS, TICK_MS, type SkillKey } from '@lumiis/shared';

let sender: (key: SkillKey) => void = () => {
  // Replaced once the connection exists.
};

let onCast: ((key: SkillKey) => void) | null = null;

/** The scene uses this to show a skill effect the moment it is cast. */
export const setSkillVisual = (fn: (key: SkillKey) => void): void => {
  onCast = fn;
};

/** performance.now() when each skill is ready to fire again. */
const readyAt = new Map<SkillKey, number>();

export const setSkillSender = (fn: (key: SkillKey) => void): void => {
  sender = fn;
};

/** Fires a skill unless the local cooldown has not run out yet. */
export const cast = (key: SkillKey): void => {
  const now = performance.now();
  if ((readyAt.get(key) ?? 0) > now) return;

  sender(key);
  onCast?.(key);
  readyAt.set(key, now + SKILLS[key].cooldownTicks * TICK_MS);
};

/** Milliseconds until the skill is ready again; 0 when ready. */
export const cooldownRemainingMs = (key: SkillKey): number =>
  Math.max(0, (readyAt.get(key) ?? 0) - performance.now());

/** How much of the cooldown is left, 0..1, for the button overlay. */
export const cooldownFraction = (key: SkillKey): number => {
  const total = SKILLS[key].cooldownTicks * TICK_MS;
  return total <= 0 ? 0 : Math.min(1, cooldownRemainingMs(key) / total);
};
