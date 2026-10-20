// Input: keyboard, a touch joystick, camera zoom and attacks.
// Everything here ends in either a movement intent (-1..1 per axis), a zoom
// factor, or "hit that one". Nothing in this file knows where a player is.

import { view } from './state';
import { resend, setManualInput } from './controller';
import { clampZoom, zoomByPinch, zoomByWheel } from './zoom';

export type SendInput = (dx: number, dy: number) => void;

export type InputOptions = {
  /** Space bar: attack whatever is closest and in reach. */
  onAttack?: () => void;
  /** Y key: pick up the closest item in reach. */
  onPickup?: () => void;
  /** A short tap or click on the world, in screen pixels. */
  onTap?: (screenX: number, screenY: number) => void;
};

type Point = { x: number; y: number };

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
/** Two fingers closer than this cannot be told apart reliably. */
const PINCH_MIN_DISTANCE = 24;
const ZOOM_STORAGE_KEY = 'lumiis.zoom';

/**
 * Typing in a field must never move the player or swing a sword, and neither
 * should the keyboard do anything while a menu is open.
 */
export const blocksGameKeys = (
  tagName: string,
  contentEditable: boolean,
  menuVisible: boolean,
): boolean =>
  menuVisible ||
  contentEditable ||
  tagName === 'INPUT' ||
  tagName === 'TEXTAREA' ||
  tagName === 'SELECT';

const isTyping = (event: KeyboardEvent): boolean => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return false;
  return blocksGameKeys(target.tagName, target.isContentEditable, false);
};

/** While the login or character screen is up, the game ignores the keyboard. */
const menuOpen = (): boolean => {
  const login = document.getElementById('login');
  const characters = document.getElementById('characters');

  return (
    (login !== null && !login.classList.contains('hidden')) ||
    (characters !== null && !characters.classList.contains('hidden'))
  );
};
/** A tap may wobble this much and still count as a tap, not a drag. */
const TAP_SLOP = 10;
const TAP_MAX_MS = 350;

export function initInput(options: InputOptions): void {
  const { onAttack, onPickup, onTap } = options;

  const pressed = new Set<string>();

  // Every pointer that is currently down, by id. Two of them mean a pinch.
  const pointers = new Map<number, Point>();
  let stickPointer: number | null = null;
  let stickOriginX = 0;
  let stickOriginY = 0;
  let stickVector: readonly [number, number] = [0, 0];
  let pinchStartDistance = 0;
  let pinchStartZoom = 1;
  let pinching = false;
  /** After a pinch, the remaining finger must not start walking. */
  let ignoreStickUntilRelease = false;
  let tapCandidate: { id: number; x: number; y: number; at: number } | null = null;

  const base = document.createElement('div');
  base.id = 'stick';
  base.hidden = true;
  const knob = document.createElement('div');
  knob.id = 'stick-knob';
  base.append(knob);
  document.body.append(base);

  const storedZoom = Number(window.localStorage.getItem(ZOOM_STORAGE_KEY));
  if (Number.isFinite(storedZoom) && storedZoom > 0) view.zoom = clampZoom(storedZoom);

  const applyZoom = (zoom: number): void => {
    view.zoom = clampZoom(zoom);
    try {
      window.localStorage.setItem(ZOOM_STORAGE_KEY, String(view.zoom));
    } catch {
      // Private mode: the zoom simply is not remembered.
    }
  };

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
    setManualInput(dx, dy);
  };

  const stopStick = (): void => {
    stickPointer = null;
    stickVector = [0, 0];
    base.hidden = true;
    commit();
  };

  // A late, lost or post-reconnect message self-heals within half a second.
  window.setInterval(() => resend(), RESEND_MS);

  window.addEventListener('keydown', (event) => {
    if (isTyping(event) || menuOpen()) return;

    if (event.code === 'Space') {
      event.preventDefault();
      // A held key repeats on its own; one press is one swing.
      if (!event.repeat) onAttack?.();
      return;
    }
    if (event.code === 'KeyY') {
      event.preventDefault();
      if (!event.repeat) onPickup?.();
      return;
    }
    if (event.code in KEY_VECTORS) {
      event.preventDefault();
      pressed.add(event.code);
      commit();
    }
  });

  window.addEventListener('keyup', (event) => {
    if (isTyping(event)) return;
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

  window.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      applyZoom(zoomByWheel(view.zoom, event.deltaY));
    },
    { passive: false },
  );

  const hud = document.getElementById('hud');

  const pointerPair = (): [Point, Point] | null => {
    const points = [...pointers.values()];
    const first = points[0];
    const second = points[1];
    return first === undefined || second === undefined ? null : [first, second];
  };

  const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

  window.addEventListener('pointerdown', (event) => {
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    // Second finger: stop walking and start pinching instead.
    if (pointers.size === 2) {
      if (stickPointer !== null) stopStick();
      tapCandidate = null;
      ignoreStickUntilRelease = true;

      const pair = pointerPair();
      if (pair !== null) {
        pinchStartDistance = Math.max(PINCH_MIN_DISTANCE, distance(pair[0], pair[1]));
        pinchStartZoom = view.zoom;
        pinching = true;
      }
      return;
    }

    if (pointers.size > 2 || ignoreStickUntilRelease) return;
    // Events can also arrive from the window itself, so only test for the HUD
    // when the target really is a node.
    const target = event.target;
    if (hud !== null && target instanceof Node && hud.contains(target)) return;

    const isMouse = event.pointerType === 'mouse';
    if (isMouse && event.button !== 0) return;

    // A click is a tap, never a movement stick: otherwise a mouse that is held
    // down (or a lost release) would keep the keyboard locked out.
    tapCandidate = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      at: performance.now(),
    };
    if (isMouse) return;

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
    const known = pointers.get(event.pointerId);
    if (known !== undefined) {
      known.x = event.clientX;
      known.y = event.clientY;
    }

    if (pinching) {
      const pair = pointerPair();
      if (pair !== null) {
        applyZoom(zoomByPinch(pinchStartZoom, pinchStartDistance, distance(pair[0], pair[1])));
      }
      return;
    }

    if (event.pointerId !== stickPointer) return;

    const dx = event.clientX - stickOriginX;
    const dy = event.clientY - stickOriginY;
    const moved = Math.hypot(dx, dy);

    if (moved < STICK_DEADZONE) {
      stickVector = [0, 0];
      knob.style.transform = 'translate(-50%, -50%)';
    } else {
      stickVector = [Math.sign(dx), Math.sign(dy)];
      const scale = Math.min(1, STICK_RADIUS / moved);
      knob.style.transform = `translate(calc(-50% + ${dx * scale}px), calc(-50% + ${dy * scale}px))`;
    }
    commit();
  });

  const releasePointer = (event: PointerEvent): void => {
    // Stop the stick first: the tap below may start a walk, and that direction
    // must survive instead of being overwritten by the "stop" of the release.
    if (event.pointerId === stickPointer) stopStick();

    if (tapCandidate !== null && tapCandidate.id === event.pointerId) {
      const wobble = Math.hypot(event.clientX - tapCandidate.x, event.clientY - tapCandidate.y);
      const held = performance.now() - tapCandidate.at;
      tapCandidate = null;
      if (wobble <= TAP_SLOP && held <= TAP_MAX_MS) onTap?.(event.clientX, event.clientY);
    }

    pointers.delete(event.pointerId);

    if (pinching && pointers.size < 2) pinching = false;
    if (pointers.size === 0) ignoreStickUntilRelease = false;
  };

  window.addEventListener('pointerup', releasePointer);
  window.addEventListener('pointercancel', releasePointer);
}
