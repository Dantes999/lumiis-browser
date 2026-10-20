// Movement intents: the keyboard, the joystick and click-to-walk all end up
// here, so exactly one place decides what the player does. The server never
// learns *why* the player moves, only in which direction.

import { dirFromInput } from '@lumiis/shared';
import { view } from './state';

export type Waypoint = { x: number; y: number };

type Vector = { dx: number; dy: number };

/** Close enough to a waypoint to move on to the next one. */
const ARRIVE_DISTANCE = 8;

let sender: (dx: number, dy: number) => void = () => {};
let manual: Vector = { dx: 0, dy: 0 };
let waypoints: Waypoint[] | null = null;
let sent: Vector = { dx: 0, dy: 0 };

export function initController(send: (dx: number, dy: number) => void): void {
  sender = send;
  manual = { dx: 0, dy: 0 };
  waypoints = null;
  sent = { dx: 0, dy: 0 };
}

/** Keyboard or joystick. Any real input cancels a running walk. */
export function setManualInput(dx: number, dy: number): void {
  manual = { dx, dy };
  if (dx !== 0 || dy !== 0) waypoints = null;
  apply(manual);
}

/** Click-to-walk: follow these waypoints until the list is empty. */
export function walkAlong(points: Waypoint[]): void {
  manual = { dx: 0, dy: 0 };
  waypoints = points.length > 0 ? [...points] : null;

  if (waypoints === null) {
    apply(manual);
    return;
  }
  // Steer right away instead of waiting for the next tick.
  step(view.self.x, view.self.y);
}

export function cancelWalk(): void {
  if (waypoints === null) return;
  waypoints = null;
  apply(manual);
}

export const isWalking = (): boolean => waypoints !== null;

/** Called once per simulation tick, before the player moves. */
export function step(x: number, y: number): void {
  if (waypoints === null) return;

  while (waypoints.length > 0) {
    const next = waypoints[0];
    if (next === undefined) break;
    if (Math.hypot(next.x - x, next.y - y) > ARRIVE_DISTANCE) break;
    waypoints.shift();
  }

  const next = waypoints[0];
  if (next === undefined) {
    waypoints = null;
    apply(manual);
    return;
  }

  apply({ dx: Math.sign(next.x - x), dy: Math.sign(next.y - y) });
}

/** Re-sends the current intent; a lost frame heals within half a second. */
export function resend(): void {
  // Before the login the server would only answer "log in first".
  if (view.status !== 'online') return;
  sender(sent.dx, sent.dy);
}

function apply(vector: Vector): void {
  view.self.moving = vector.dx !== 0 || vector.dy !== 0;
  const dir = dirFromInput(vector.dx, vector.dy);
  if (dir !== null) view.self.dir = dir;

  if (vector.dx === sent.dx && vector.dy === sent.dy) return;
  sent = { dx: vector.dx, dy: vector.dy };
  sender(sent.dx, sent.dy);
}
