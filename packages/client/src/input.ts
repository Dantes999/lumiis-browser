// Input: keyboard and a touch joystick that both end in the same two numbers.
// The result is an intent (-1..1 per axis), never a position.

import { dirFromInput } from '@lumiis/shared';
import { view } from './state';

export type SendInput = (dx: number, dy: number) => void;

const KEY_VECTORS: Record<string, readonly [number, number]> = {
  KeyW: [0, -1],
  ArrowUp: [0, -1],
  KeyS: [0, 1],
  ArrowDown: [0, 1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};

const STICK_RADIUS = 56;
const STICK_DEADZONE = 12;
const RESEND_MS = 500;

export function initInput(send: SendInput): void {
  const pressed = new Set<string>();
  let lastSent: readonly [number, number] = [0, 0];

  // Joystick state: active only while a finger (or the mouse) is down.
  let stickPointer: number | null = null;
  let stickOriginX = 0;
  let stickOriginY = 0;
  let stickVector: readonly [number, number] = [0, 0];

  const base = document.createElement('div');
  base.id = 'stick';
  base.hidden = true;
  const knob = document.createElement('div');
  knob.id = 'stick-knob';
  base.append(knob);
  document.body.append(base);

  const currentVector = (): readonly [number, number] => {
    if (stickPointer !== null) return stickVector;

    let dx = 0;
    let dy = 0;
    for (const code of pressed) {
      const vector = KEY_VECTORS[code];
      if (vector === undefined) continue;
      dx += vector[0];
      dy += vector[1];
    }
    return [Math.sign(dx), Math.sign(dy)];
  };

  const commit = (): void => {
    const [dx, dy] = currentVector();
    const dir = dirFromInput(dx, dy);

    view.self.moving = dir !== null;
    if (dir !== null) view.self.dir = dir;

    if (dx !== lastSent[0] || dy !== lastSent[1]) {
      lastSent = [dx, dy];
      send(dx, dy);
    }
  };

  // A late, lost or post-reconnect message self-heals within half a second.
  window.setInterval(() => send(lastSent[0], lastSent[1]), RESEND_MS);

  window.addEventListener('keydown', (event) => {
    if (event.code in KEY_VECTORS) {
      event.preventDefault();
      pressed.add(event.code);
      commit();
    }
  });

  window.addEventListener('keyup', (event) => {
    if (event.code in KEY_VECTORS) {
      event.preventDefault();
      pressed.delete(event.code);
      commit();
    }
  });

  // Losing focus while a key is held must not leave the player running.
  window.addEventListener('blur', () => {
    pressed.clear();
    commit();
  });

  const hud = document.getElementById('hud');

  window.addEventListener('pointerdown', (event) => {
    if (stickPointer !== null) return;
    if (hud !== null && hud.contains(event.target as Node)) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    stickPointer = event.pointerId;
    stickOriginX = event.clientX;
    stickOriginY = event.clientY;
    stickVector = [0, 0];

    base.hidden = false;
    base.style.left = `${stickOriginX}px`;
    base.style.top = `${stickOriginY}px`;
    knob.style.transform = 'translate(-50%, -50%)';
    commit();
  });

  window.addEventListener('pointermove', (event) => {
    if (event.pointerId !== stickPointer) return;

    const dx = event.clientX - stickOriginX;
    const dy = event.clientY - stickOriginY;
    const distance = Math.hypot(dx, dy);

    if (distance < STICK_DEADZONE) {
      stickVector = [0, 0];
      knob.style.transform = 'translate(-50%, -50%)';
    } else {
      stickVector = [Math.sign(dx), Math.sign(dy)];
      const scale = Math.min(1, STICK_RADIUS / distance);
      knob.style.transform = `translate(calc(-50% + ${dx * scale}px), calc(-50% + ${dy * scale}px))`;
    }
    commit();
  });

  const releaseStick = (event: PointerEvent): void => {
    if (event.pointerId !== stickPointer) return;
    stickPointer = null;
    stickVector = [0, 0];
    base.hidden = true;
    commit();
  };

  window.addEventListener('pointerup', releaseStick);
  window.addEventListener('pointercancel', releaseStick);
}
