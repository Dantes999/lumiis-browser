// Turning a click or a key press into an attack intent.
// The client only says "I want to hit that one"; the server decides whether the
// hit lands.

import { ATTACK_RANGE, withinAttackRange } from '@lumiis/shared';
import { sfx } from './audio';
import { view, type MonsterState } from './state';

/** How close to the pointer a monster has to be to count as clicked. */
const TAP_RADIUS = 26;

let sender: (target: number) => void = () => {
  // Replaced once the connection exists.
};

/** Until this moment the figure shows its attack frames. */
let attackUntil = 0;

export const attackPoseUntil = (): number => attackUntil;

export const setAttackSender = (fn: (target: number) => void): void => {
  sender = fn;
};

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

/** Space bar: hit the closest monster that is already within reach. */
export function attackNearestInRange(): boolean {
  const target = nearest(view.self.x, view.self.y, ATTACK_RANGE);
  if (target === null) return false;

  sender(target.id);
  attackUntil = performance.now() + 320;
  sfx.swing();
  return true;
}

/** Tap or click: only a monster under the pointer, and only within reach. */
export function attackAt(worldX: number, worldY: number): boolean {
  const target = nearest(worldX, worldY, TAP_RADIUS);
  if (target === null) return false;
  if (!withinAttackRange(view.self, target)) return false;

  sender(target.id);
  attackUntil = performance.now() + 320;
  sfx.swing();
  return true;
}
