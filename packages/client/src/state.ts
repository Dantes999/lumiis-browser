// Client-side state. One mutable object: the network writes into it, the
// simulation and the scene read from it.

import type {
  ChannelInfo,
  CharacterSummary,
  ClassKey,
  Direction,
  Equipment,
  InventorySlot,
} from '@lumiis/shared';

export type ConnectionStatus = 'connecting' | 'online' | 'offline';

/** Another player, as the server last reported them, plus render smoothing. */
export type RemotePlayer = {
  id: number;
  name: string;
  /** Look ids of the style pack manifest. */
  body: string;
  hair: string;
  x: number;
  y: number;
  dir: Direction;
  moving: boolean;
  hp: number;
  maxHp: number;
  weapon: string | null;
  armor: string | null;
  /** performance.now() when the shown swing ends; 0 when standing still. */
  attackUntil: number;
  /** performance.now() when their whirlwind visual ends; 0 when none. */
  whirlwindUntil: number;
  /** Active buffs with their remaining time in seconds. */
  buffs: Record<string, number>;
  renderX: number;
  renderY: number;
};

/** One chat line in the window. */
export type ChatLine = {
  kind: 'map' | 'global' | 'whisper' | 'system';
  from: string;
  text: string;
  /** Set for whispers: the other side. */
  to?: string;
  at: number;
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
  dead: boolean;
  renderX: number;
  renderY: number;
};

/**
 * The local player. x/y are the predicted position; prevX/prevY the position
 * before the last simulation step, which is what makes motion smooth between
 * the 20 Hz steps. offsetX/offsetY is the last server correction, faded out.
 */
export type SelfState = {
  name: string;
  cls: ClassKey;
  /** Look ids of the style pack manifest. */
  body: string;
  hair: string;
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  /** Where the body faces (sprite and swing). */
  dir: Direction;
  /** Where the player walks; a swing never changes this. */
  moveDir: Direction;
  moving: boolean;
  offsetX: number;
  offsetY: number;
  hp: number;
  maxHp: number;
  sp: number;
  maxSp: number;
  stats: { str: number; vit: number; int: number; dex: number };
  /** Unspent stat points. */
  points: number;
  /** Derived combat values, straight from the server. */
  attack: number;
  defense: number;
  matk: number;
  mdef: number;
  level: number;
  exp: number;
  yang: number;
  /** Active buffs with their remaining time in seconds. */
  buffs: Record<string, number>;
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
  equipment: Equipment;
  notice: string | null;
  /** Last chat lines, oldest first. */
  chat: ChatLine[];
  /** Last login failure, shown in the login box. */
  authError: string | null;
  /** Characters of the logged in account, null until the server sent them. */
  characters: CharacterSummary[] | null;
  /** Map the player is standing on, sent with the welcome. */
  mapId: string | null;
  /** Channel of this character (1 based) and how many the map has. */
  channel: number;
  channelCount: number;
  /** Channel list for the login picker or the in-game popup; null when none. */
  channelOptions: { id: number | null; map: string; list: ChannelInfo[] } | null;
  characterMax: number;
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
    name: '',
    cls: 'warrior',
    body: '',
    hair: '',
    x: 0,
    y: 0,
    prevX: 0,
    prevY: 0,
    dir: 0,
    moveDir: 0,
    moving: false,
    offsetX: 0,
    offsetY: 0,
    hp: 100,
    maxHp: 100,
    sp: 60,
    maxSp: 60,
    stats: { str: 0, vit: 0, int: 0, dex: 0 },
    points: 0,
    attack: 12,
    defense: 0,
    matk: 12,
    mdef: 0,
    level: 1,
    exp: 0,
    yang: 0,
    buffs: {},
  },
  others: new Map(),
  monsters: new Map(),
  ground: new Map(),
  inventory: [],
  equipment: { weapon: null, armor: null },
  notice: null,
  chat: [],
  authError: null,
  characters: null,
  mapId: null,
  channel: 1,
  channelCount: 1,
  channelOptions: null,
  characterMax: 4,
  noticeUntil: 0,
  zoom: 1,
};

export const playerCount = (): number => view.others.size + (view.selfId === null ? 0 : 1);
