// Movement intents: the keyboard and the touch joystick end up here, so exactly
// one place decides what the player does. The server never learns *why* the
// player moves, only in which direction.

import { dirFromInput } from '@lumiis/shared';
import { view } from './state';

type Vector = { dx: number; dy: number };

let sender: (dx: number, dy: number) => void = () => {};
let manual: Vector = { dx: 0, dy: 0 };
let sent: Vector = { dx: 0, dy: 0 };

export function initController(send: (dx: number, dy: number) => void): void {
  sender = send;
  manual = { dx: 0, dy: 0 };
  sent = { dx: 0, dy: 0 };
}

/** Keyboard or joystick. */
export function setManualInput(dx: number, dy: number): void {
  manual = { dx, dy };
  apply(manual);
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
