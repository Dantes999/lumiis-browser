// Client-side state. One mutable object: the network writes into it, the
// simulation and the scene read from it.

import type { Direction, InventorySlot } from '@lumiis/shared';

export type ConnectionStatus = 'connecting' | 'online' | 'offline';

/** Another player, as the server last reported them, plus render smoothing. */
export type RemotePlayer = {
  id: number;
  name: string;
  x: number;
  y: number;
  dir: Direction;
  moving: boolean;
  renderX: number;
  renderY: number;
};

/** An item lying on the ground. */
export type GroundItemState = {
  id: number;
  key: string;
  x: number;
  y: number;
  count: number;
};

/** A monster as the server last reported it, plus render smoothing. */
export type MonsterState = {
  id: number;
  key: string;
  x: number;
  y: number;
  dir: Direction;
  hp: number;
  maxHp: number;
  moving: boolean;
  renderX: number;
  renderY: number;
};

/**
 * The local player. x/y are the predicted position; prevX/prevY the position
 * before the last simulation step, which is what makes motion smooth between
 * the 20 Hz steps. offsetX/offsetY is the last server correction, faded out.
 */
export type SelfState = {
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  dir: Direction;
  moving: boolean;
  offsetX: number;
  offsetY: number;
  hp: number;
  maxHp: number;
  level: number;
  exp: number;
  yang: number;
};

export type ViewState = {
  status: ConnectionStatus;
  tick: number;
  pingMs: number | null;
  selfId: number | null;
  self: SelfState;
  others: Map<number, RemotePlayer>;
  monsters: Map<number, MonsterState>;
  ground: Map<number, GroundItemState>;
  inventory: InventorySlot[];
  notice: string | null;
  /** Last login failure, shown in the login box. */
  authError: string | null;
  /** When the current notice stops being shown, in performance.now() ms. */
  noticeUntil: number;
  /** Camera zoom; 1 shows the world at native size. */
  zoom: number;
};

export const view: ViewState = {
  status: 'connecting',
  tick: 0,
  pingMs: null,
  selfId: null,
  self: {
    x: 0,
    y: 0,
    prevX: 0,
    prevY: 0,
    dir: 0,
    moving: false,
    offsetX: 0,
    offsetY: 0,
    hp: 100,
    maxHp: 100,
    level: 1,
    exp: 0,
    yang: 0,
  },
  others: new Map(),
  monsters: new Map(),
  ground: new Map(),
  inventory: [],
  notice: null,
  authError: null,
  noticeUntil: 0,
  zoom: 1,
};

export const playerCount = (): number => view.others.size + (view.selfId === null ? 0 : 1);
