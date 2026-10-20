import { beforeEach, describe, expect, it } from 'vitest';
import { INVENTORY_SLOTS, type InventorySlot } from '@lumiis/shared';
import { Store, type CharacterSave } from '../src/store/db.js';

let store: Store;

beforeEach(() => {
  store = new Store(':memory:');
});

const register = async (name: string, password: string): Promise<number> => {
  const result = await store.register(name, password);
  if (!result.ok) throw new Error(`register failed: ${result.reason}`);
  return result.accountId;
};

const emptyInventory = (): InventorySlot[] => new Array<InventorySlot>(INVENTORY_SLOTS).fill(null);

describe('accounts', () => {
  it('registers and logs in again', async () => {
    await register('Kain', 'secret123');

    const login = await store.login('Kain', 'secret123');
    expect(login.ok).toBe(true);
    if (login.ok) expect(login.save).toBeNull();
  });

  it('refuses a name that is already taken, whatever the case', async () => {
    await register('Kain', 'secret123');

    const again = await store.register('kain', 'other123');
    expect(again.ok).toBe(false);
  });

  it('refuses a wrong password', async () => {
    await register('Kain', 'secret123');

    const wrong = await store.login('Kain', 'wrongpass');
    expect(wrong.ok).toBe(false);
  });

  it('does not tell an unknown name apart from a wrong password', async () => {
    await register('Kain', 'secret123');

    const unknown = await store.login('Nobody', 'secret123');
    const wrong = await store.login('Kain', 'wrongpass');

    expect(unknown.ok).toBe(false);
    expect(wrong.ok).toBe(false);
    if (!unknown.ok && !wrong.ok) expect(unknown.reason).toBe(wrong.reason);
  });
});

describe('characters', () => {
  it('stores and loads a character with its inventory', async () => {
    const accountId = await register('Kain', 'secret123');

    const inventory = emptyInventory();
    inventory[0] = { key: 'wolf_fur', count: 7 };
    inventory[3] = { key: 'boar_tusk', count: 1 };

    const save: CharacterSave = {
      level: 5,
      exp: 20,
      yang: 300,
      hp: 70,
      map: 'testmap',
      x: 100.5,
      y: 200.25,
      dir: 3,
      inventory,
    };
    store.saveCharacter(accountId, save);

    const login = await store.login('Kain', 'secret123');
    expect(login.ok).toBe(true);
    if (!login.ok || login.save === null) throw new Error('no character loaded');

    expect(login.save.level).toBe(5);
    expect(login.save.exp).toBe(20);
    expect(login.save.yang).toBe(300);
    expect(login.save.hp).toBe(70);
    expect(login.save.map).toBe('testmap');
    expect(login.save.x).toBeCloseTo(100.5, 3);
    expect(login.save.y).toBeCloseTo(200.25, 3);
    expect(login.save.dir).toBe(3);
    expect(login.save.inventory[0]).toEqual({ key: 'wolf_fur', count: 7 });
    expect(login.save.inventory[3]).toEqual({ key: 'boar_tusk', count: 1 });
    expect(login.save.inventory[1]).toBeNull();
  });

  it('replaces the old state completely on the next save', async () => {
    const accountId = await register('Kain', 'secret123');

    const first = emptyInventory();
    first[2] = { key: 'wolf_fur', count: 3 };
    store.saveCharacter(accountId, {
      level: 1,
      exp: 0,
      yang: 10,
      hp: 100,
      map: 'testmap',
      x: 1,
      y: 2,
      dir: 0,
      inventory: first,
    });

    const second = emptyInventory();
    second[0] = { key: 'boar_tusk', count: 2 };
    store.saveCharacter(accountId, {
      level: 2,
      exp: 5,
      yang: 20,
      hp: 90,
      map: 'testmap',
      x: 3,
      y: 4,
      dir: 1,
      inventory: second,
    });

    const save = store.loadCharacter(accountId);
    if (save === null) throw new Error('no character loaded');

    expect(save.level).toBe(2);
    expect(save.inventory[2]).toBeNull();
    expect(save.inventory[0]).toEqual({ key: 'boar_tusk', count: 2 });
  });

  it('returns nothing for an account without a character', async () => {
    const accountId = await register('Kain', 'secret123');
    expect(store.loadCharacter(accountId)).toBeNull();
  });
});
