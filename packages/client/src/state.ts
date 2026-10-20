// Client-side state. One mutable object: the network writes into it, the
// simulation and the scene read from it.

import type { Direction } from '@lumiis/shared';

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
};

export type ViewState = {
  status: ConnectionStatus;
  tick: number;
  pingMs: number | null;
  selfId: number | null;
  self: SelfState;
  others: Map<number, RemotePlayer>;
  monsters: Map<number, MonsterState>;
  notice: string | null;
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
  },
  others: new Map(),
  monsters: new Map(),
  notice: null,
  zoom: 1,
};

export const playerCount = (): number => view.others.size + (view.selfId === null ? 0 : 1);
