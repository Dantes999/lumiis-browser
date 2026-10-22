// Messages between the main process and one map worker.
//
// The main process owns the sockets, the accounts and the database. A worker
// owns a set of maps and their worlds. Everything a player does is forwarded as
// an intent; results come back as snapshots, notices, rewards and saves.

import type { Equipment, InventorySlot, MapData, SkillKey } from '@lumiis/shared';
import type { CharacterSave } from '../store/db.js';
import type { PlayerSeed, RewardBroadcast } from '../game/world.js';

export type WorkerInit = {
  /** Maps this worker needs (one shared map can appear in several workers). */
  maps: MapData[];
  /** World keys it owns: the map id, or map#ch2 for a channel. */
  keys: string[];
  /** How many channels each map runs (1 = none). */
  channels: number;
};

export type ToWorker =
  | {
      t: 'join';
      playerId: number;
      characterId: number;
      name: string;
      /** Target world key; the host picked the worker that runs it. */
      world: string;
      seed: PlayerSeed;
    }
  | { t: 'leave'; playerId: number }
  | { t: 'input'; playerId: number; dx: number; dy: number }
  | { t: 'attack'; playerId: number; target: number | null; dir: number | null }
  | { t: 'skill'; playerId: number; key: SkillKey }
  | { t: 'pickup'; playerId: number; target: number }
  | { t: 'equip'; playerId: number; slot: number }
  | { t: 'useItem'; playerId: number; slot: number }
  | { t: 'unequip'; playerId: number; piece: 'weapon' | 'armor' }
  | { t: 'settings'; playerId: number; autoPickup: boolean; types: string[] }
  /** Move the player to another channel world (same map). */
  | { t: 'switch'; playerId: number; world: string }
  | { t: 'flush' };

export type FromWorker =
  | {
      t: 'joined';
      playerId: number;
      world: string;
      tick: number;
      slots: InventorySlot[];
      equipment: Equipment;
    }
  | { t: 'joinFailed'; playerId: number }
  | { t: 'snapshots'; ticks: Array<[string, number]>; entries: Array<[number, Uint8Array]> }
  | { t: 'notice'; playerId: number; text: string }
  | { t: 'inventory'; playerId: number; slots: InventorySlot[]; equipment: Equipment }
  | { t: 'reward'; worldId: string; reward: RewardBroadcast }
  | { t: 'save'; characterId: number; save: CharacterSave }
  | {
      t: 'transfer';
      playerId: number;
      characterId: number;
      name: string;
      to: string;
      save: CharacterSave;
    }
  | { t: 'stats'; players: number; tickMs: number; tickMsMax: number }
  /** The player now lives in this world; the main process updates its books. */
  | { t: 'switched'; playerId: number; world: string }
  | { t: 'flushed' };
