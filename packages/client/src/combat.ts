// Turning a click or a key press into a swing.
// A swing always happens: it goes where the body faces, or towards the monster
// that was aimed at. Whether anything is hit is decided by the server, by the
// arc of the swing at the moment the blade is through.

import { dirFromInput, swingFor, swingMs, type Direction } from '@lumiis/shared';
import { sfx } from './audio';
import { aimDirection } from './aim';
import { view, type MonsterState } from './state';

/** How close to the pointer a monster has to be to count as clicked. */
const TAP_RADIUS = 26;

/** What the server is told: a monster to turn to, or a direction to swing in. */
export type SwingMessage = { target?: number; dir?: number };

let sender: (message: SwingMessage) => void = () => {
  // Replaced once the connection exists.
};

/** The swing the figure is showing right now, for the scene. */
export type AttackPose = {
  startedAt: number;
  durationMs: number;
  dir: Direction;
  /** +1 sweeps one way, -1 the other; hits alternate like real swings. */
  sweep: 1 | -1;
};

let pose: AttackPose | null = null;
let swings = 0;

/** A little extra so the client does not out-run the server and get "Not so fast". */
const SWING_GRACE_MS = 60;

/** The arm must be back before the next swing starts. */
const canSwing = (): boolean => {
  if (pose === null) return true;
  return performance.now() - pose.startedAt >= pose.durationMs + SWING_GRACE_MS;
};

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

const begin = (target: MonsterState | null, fallback: Direction): boolean => {
  if (!canSwing()) return false;

  const profile = swingFor(view.equipment.weapon);

  const toward =
    target === null ? null : dirFromInput(target.x - view.self.x, target.y - view.self.y);
  const dir = toward ?? fallback;

  sender(target === null ? { dir } : { target: target.id });

  // The figure turns straight away; the server will agree.
  view.self.dir = dir;
  swings += 1;
  pose = {
    startedAt: performance.now(),
    durationMs: swingMs(profile),
    dir,
    sweep: swings % 2 === 0 ? -1 : 1,
  };

  sfx.swing();
  return true;
};

/** Space bar: swing where the mouse points, or straight ahead. */
export function swingForward(): void {
  begin(null, aimDirection() ?? view.self.dir);
}

/** Whether the attack key is being held down. */
let attackHeld = false;

export const setAttackHeld = (held: boolean): void => {
  attackHeld = held;
};

/**
 * Called every frame: while the key is held, keep swinging at the weapon's own
 * pace. The swing alternates left-right on its own, which makes the combo.
 */
export const heldAttack = (): void => {
  if (attackHeld && canSwing()) swingForward();
};

/**
 * Tap or click in the world: a monster under the pointer is aimed at, empty
 * ground is swung at. Returns false only when there is no direction at all.
 */
export function attackAt(worldX: number, worldY: number): boolean {
  const target = nearest(worldX, worldY, TAP_RADIUS);
  if (target !== null) return begin(target, view.self.dir);

  const dir = dirFromInput(worldX - view.self.x, worldY - view.self.y);
  if (dir === null) return false;

  return begin(null, dir);
}

export const setAttackSender = (fn: (message: SwingMessage) => void): void => {
  sender = fn;
};
