// One map worker: it owns a subset of the maps and ticks them on its own.
//
// The main process never touches these worlds. It forwards intentions and gets
// back snapshots, notices, rewards, saves and the occasional hand-over when a
// portal leads into another shard.

import { parentPort, workerData } from 'node:worker_threads';
import { SNAPSHOT_EVERY_TICKS, TICK_MS, TICK_RATE } from '@lumiis/shared';
import { Realm } from '../game/realm.js';
import { FixedStepLoop } from '../game/loop.js';
import type { FromWorker, ToWorker, WorkerInit } from './protocol.js';

const port = parentPort;
if (port === null) throw new Error('shard worker started without a parent port');

const init = workerData as WorkerInit;
const realm = new Realm(init.maps, new Set(init.keys), init.channels);
/** Character id per player, so saves can be written by the main process. */
const characters = new Map<number, number>();
let saveCursor = 0;

const post = (message: FromWorker): void => port.postMessage(message);

const saveOne = (playerId: number): void => {
  const characterId = characters.get(playerId);
  if (characterId === undefined) return;
  const save = realm.saveOf(playerId);
  if (save !== null) post({ t: 'save', characterId, save });
};

const tickTimes: number[] = [];

const loop = new FixedStepLoop(TICK_MS, (tick) => {
  const startedAt = performance.now();

  realm.tick();

  // Portals into another shard: hand the player and his save over.
  for (const warp of realm.drainOutgoingWarps()) {
    const world = realm.worldOf(warp.playerId);
    const player = world?.getPlayer(warp.playerId);
    const characterId = characters.get(warp.playerId);
    if (world === null || player === undefined || characterId === undefined) continue;

    const save = realm.saveOf(warp.playerId);
    if (save === null) continue;

    const moved = { ...save, map: warp.to, x: warp.x, y: warp.y };
    realm.leave(warp.playerId);
    characters.delete(warp.playerId);
    post({
      t: 'transfer',
      playerId: warp.playerId,
      characterId,
      name: player.name,
      to: warp.world ?? warp.to,
      save: moved,
    });
  }

  for (const event of realm.drainEvents()) {
    post({ t: 'notice', playerId: event.playerId, text: event.text });
  }

  for (const { worldId, reward } of realm.drainRewards()) post({ t: 'reward', worldId, reward });

  for (const update of realm.drainInventoryUpdates()) {
    const equipment = realm.equipmentOf(update.playerId) ?? { weapon: null, armor: null };
    post({ t: 'inventory', playerId: update.playerId, slots: update.slots, equipment });
  }

  if (tick % SNAPSHOT_EVERY_TICKS === 0) {
    const ticks: Array<[string, number]> = [];
    for (const world of realm.worldKeys()) ticks.push([world, realm.world(world)?.tick ?? 0]);
    post({ t: 'snapshots', ticks, entries: [...realm.snapshotBuffers()] });
  }

  // How long a player can walk into a busy cell is the number that matters.
  tickTimes.push(performance.now() - startedAt);
  if (tickTimes.length > TICK_RATE * 2) tickTimes.shift();
  if (tick % TICK_RATE === 0 && tickTimes.length > 0) {
    const sum = tickTimes.reduce((total, value) => total + value, 0);
    post({
      t: 'stats',
      players: characters.size,
      tickMs: Math.round((sum / tickTimes.length) * 10) / 10,
      tickMsMax: Math.round(Math.max(...tickTimes) * 10) / 10,
    });
  }

  // A slice of the players is saved every tick, never all at once.
  const ids = [...characters.keys()];
  if (ids.length > 0) {
    const limit = Math.max(1, Math.ceil(ids.length / (TICK_RATE * 20)));
    for (let index = 0; index < limit; index += 1) {
      const playerId = ids[(saveCursor + index) % ids.length];
      if (playerId !== undefined) saveOne(playerId);
    }
    saveCursor = (saveCursor + limit) % ids.length;
  }
});
loop.start();

port.on('message', (message: ToWorker) => {
  switch (message.t) {
    case 'join': {
      const player = realm.joinIn(message.world, message.seed, message.playerId);
      if (player === null) {
        post({ t: 'joinFailed', playerId: message.playerId });
        return;
      }

      characters.set(player.id, message.characterId);
      post({
        t: 'joined',
        playerId: player.id,
        world: message.world,
        tick: realm.world(message.world)?.tick ?? 0,
        slots: realm.inventoryOf(player.id) ?? [],
        equipment: realm.equipmentOf(player.id) ?? { weapon: null, armor: null },
      });
      return;
    }

    case 'leave':
      saveOne(message.playerId);
      realm.leave(message.playerId);
      characters.delete(message.playerId);
      return;

    case 'input':
      realm.setInput(message.playerId, message.dx, message.dy);
      return;

    case 'attack': {
      const result = realm.attack(message.playerId, message.target, message.dir);
      if (!result.ok) post({ t: 'notice', playerId: message.playerId, text: result.reason });
      return;
    }

    case 'skill': {
      const result = realm.useSkill(message.playerId, message.key);
      if (!result.ok) post({ t: 'notice', playerId: message.playerId, text: result.reason });
      return;
    }

    case 'pickup': {
      const result = realm.pickup(message.playerId, message.target);
      if (!result.ok) post({ t: 'notice', playerId: message.playerId, text: result.reason });
      return;
    }

    case 'equip': {
      const result = realm.equip(message.playerId, message.slot);
      if (!result.ok) post({ t: 'notice', playerId: message.playerId, text: result.reason });
      return;
    }

    case 'unequip': {
      const result = realm.unequip(message.playerId, message.piece);
      if (!result.ok) post({ t: 'notice', playerId: message.playerId, text: result.reason });
      return;
    }

    case 'settings':
      realm.setPickupSettings(message.playerId, message.autoPickup, message.types);
      return;

    case 'flush':
      for (const playerId of characters.keys()) saveOne(playerId);
      post({ t: 'flushed' });
      return;
  }
});
