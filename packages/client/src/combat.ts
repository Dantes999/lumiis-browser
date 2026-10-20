// Turning a click or a key press into an attack intent.
// The client only says "I want to hit that one"; the server decides whether the
// hit lands.

import { swingFor, swingMs } from '@lumiis/shared';
import { sfx } from './audio';
import { view, type MonsterState } from './state';

/** How close to the pointer a monster has to be to count as clicked. */
const TAP_RADIUS = 26;

let sender: (target: number) => void = () => {
  // Replaced once the connection exists.
};

/** The swing the figure is showing right now, for the scene. */
type AttackPose = { startedAt: number; durationMs: number };

let pose: AttackPose | null = null;

export const attackPose = (): AttackPose | null => pose;

const nearest = (x: number, y: number, radius: number): MonsterState | null => {
  let best: MonsterState | null = null;
  let bestDistance = radius;

  for (const monster of view.monsters.values()) {
    const distance = Math.hypot(monster.x - x, monster.y - y);
    if (distance <= bestDistance) {
      best = monster;
      bestDistance = distance;
    }
  }
  return best;
};

/** True when the monster stands inside the reach of the weapon in hand. */
const inReach = (monster: MonsterState): boolean => {
  const profile = swingFor(view.equipment.weapon);
  return Math.hypot(monster.x - view.self.x, monster.y - view.self.y) <= profile.range;
};

/** Starts the visible swing and tells the server; false when nothing is in reach. */
const swingAt = (target: MonsterState): boolean => {
  const profile = swingFor(view.equipment.weapon);

  sender(target.id);
  pose = { startedAt: performance.now(), durationMs: swingMs(profile) };
  sfx.swing();
  return true;
};

/** Space bar: hit the closest monster that is already within reach. */
export function attackNearestInRange(): boolean {
  const profile = swingFor(view.equipment.weapon);
  const target = nearest(view.self.x, view.self.y, profile.range);
  if (target === null) return false;
  return swingAt(target);
}

/** Tap or click: only a monster under the pointer, and only within reach. */
export function attackAt(worldX: number, worldY: number): boolean {
  const target = nearest(worldX, worldY, TAP_RADIUS);
  if (target === null) return false;
  if (!inReach(target)) return false;
  return swingAt(target);
}

export const setAttackSender = (fn: (target: number) => void): void => {
  sender = fn;
};
