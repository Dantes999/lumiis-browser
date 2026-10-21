// Channels: the same map runs several times, each copy with its own monsters.
// A player joins the emptiest channel and stays on it at a portal. Players on
// different channels do not see each other, by design (like Metin2 CH1/CH2).

import { describe, expect, it } from 'vitest';
import { TILE, type MapData } from '@lumiis/shared';
import { Realm } from '../src/game/realm.js';

const WIDTH = 32;
const HEIGHT = 32;

const field = (): MapData => {
  const tiles = new Array<number>(WIDTH * HEIGHT).fill(TILE.GRASS);
  tiles[16 * WIDTH + 20] = TILE.PORTAL; // a gate back onto the same map

  return {
    id: 'field',
    width: WIDTH,
    height: HEIGHT,
    spawn: { x: 16, y: 16 },
    tiles,
    spawns: [{ kind: 'mob', key: 'wolf', tx: 18, ty: 16 }],
    portals: [{ tx: 20, ty: 16, to: 'field', spawnX: 16, spawnY: 17 }],
  };
};

const decode = (bytes: Uint8Array | undefined): { players: Array<{ id: number }> } => {
  if (bytes === undefined) throw new Error('no snapshot');
  return JSON.parse(new TextDecoder().decode(bytes)) as { players: Array<{ id: number }> };
};

describe('channels', () => {
  it('without channels a map is one world named after the map', () => {
    const realm = new Realm([field()]);
    expect(realm.worldKeys()).toEqual(['field']);
  });

  it('with two channels every map has two worlds', () => {
    const realm = new Realm([field()], null, 2);
    expect(realm.worldKeys().sort()).toEqual(['field#ch1', 'field#ch2']);
    expect(realm.mapIds).toEqual(['field']);
  });

  it('puts a joining player on the emptiest channel', () => {
    const realm = new Realm([field()], null, 2);
    const first = realm.join({ map: 'field', accountId: 1, characterId: 1, name: 'A' });
    const second = realm.join({ map: 'field', accountId: 2, characterId: 2, name: 'B' });
    const third = realm.join({ map: 'field', accountId: 3, characterId: 3, name: 'C' });

    expect(realm.worldIdOf(first!.id)).toBe('field#ch1');
    expect(realm.worldIdOf(second!.id)).toBe('field#ch2');
    // Both are equally full now, so the third fills the first one up.
    expect(realm.worldIdOf(third!.id)).toBe('field#ch1');

    expect(realm.world('field#ch1')?.playerCount).toBe(2);
    expect(realm.world('field#ch2')?.playerCount).toBe(1);
  });

  it('keeps players of different channels out of each other\'s snapshots', () => {
    const realm = new Realm([field()], null, 2);
    const a = realm.join({ map: 'field', accountId: 1, characterId: 1, name: 'A' });
    const b = realm.join({ map: 'field', accountId: 2, characterId: 2, name: 'B' });

    const view = decode(realm.snapshotBuffers().get(a!.id));
    expect(view.players.map((entry) => entry.id)).toEqual([a!.id]);
    expect(realm.worldIdOf(b!.id)).toBe('field#ch2');
  });

  it('gives every channel its own monsters', () => {
    const realm = new Realm([field()], null, 2);
    expect(realm.world('field#ch1')?.snapshot().monsters).toHaveLength(1);
    expect(realm.world('field#ch2')?.snapshot().monsters).toHaveLength(1);
  });

  it('joins a chosen channel', () => {
    const realm = new Realm([field()], null, 2);
    const player = realm.join(
      { map: 'field', accountId: 1, characterId: 1, name: 'A' },
      undefined,
      2,
    );
    expect(realm.worldIdOf(player!.id)).toBe('field#ch2');
  });

  it('reports how many players each channel has', () => {
    const realm = new Realm([field()], null, 2);
    realm.join({ map: 'field', accountId: 1, characterId: 1, name: 'A' });
    realm.join({ map: 'field', accountId: 2, characterId: 2, name: 'B' });

    expect(realm.channelInfo('field')).toEqual([
      { channel: 1, players: 1 },
      { channel: 2, players: 1 },
    ]);
  });

  it('switches channel and keeps id and position', () => {
    const realm = new Realm([field()], null, 2);
    const player = realm.join({
      map: 'field',
      accountId: 1,
      characterId: 1,
      name: 'A',
      x: 16 * 32 + 16,
      y: 16 * 32 + 16,
    });
    const before = { x: player!.x, y: player!.y };

    expect(realm.moveToChannel(player!.id, 2).ok).toBe(true);
    expect(realm.worldIdOf(player!.id)).toBe('field#ch2');

    const moved = realm.world('field#ch2')?.getPlayer(player!.id);
    expect(moved?.id).toBe(player!.id);
    expect(moved?.x).toBe(before.x);
    expect(moved?.y).toBe(before.y);
    expect(realm.world('field#ch1')?.getPlayer(player!.id)).toBeUndefined();
  });

  it('keeps the channel when a player walks through a portal', () => {
    const realm = new Realm([field()], null, 2);
    // First player fills ch1, so the second (on the gate) starts on ch2.
    const first = realm.join({ map: 'field', accountId: 1, characterId: 1, name: 'A' });
    const second = realm.join({
      map: 'field',
      accountId: 2,
      characterId: 2,
      name: 'B',
      x: 20 * 32 + 16,
      y: 16 * 32 + 16,
    });

    expect(realm.worldIdOf(first!.id)).toBe('field#ch1');
    expect(realm.worldIdOf(second!.id)).toBe('field#ch2');

    realm.tick();

    expect(realm.worldIdOf(second!.id)).toBe('field#ch2');
    expect(realm.world('field#ch2')?.getPlayer(second!.id)?.x).toBe((16 + 0.5) * 32);
    expect(realm.world('field#ch1')?.getPlayer(second!.id)).toBeUndefined();
  });
});
