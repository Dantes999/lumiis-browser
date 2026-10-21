import { beforeEach, describe, expect, it } from 'vitest';
import { INVENTORY_SLOTS, type InventorySlot } from '@lumiis/shared';
import { MAX_CHARACTERS, Store, type CharacterSave } from '../src/store/db.js';

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

const makeCharacter = (accountId: number, name: string): number => {
  const result = store.createCharacter(accountId, name);
  if (!result.ok) throw new Error(`create failed: ${result.reason}`);
  return result.id;
};

const sampleSave = (name: string): CharacterSave => {
  const inventory = emptyInventory();
  inventory[0] = { key: 'wolf_fur', count: 7 };
  inventory[3] = { key: 'boar_tusk', count: 1 };

  return {
    name,
    body: 'default',
    hair: 'helmet',
    equipment: { weapon: 'iron_sword', armor: 'padded_armor' },
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
};

describe('accounts', () => {
  it('registers and logs in again', async () => {
    await register('Kain', 'secret123');

    const login = await store.login('Kain', 'secret123');
    expect(login.ok).toBe(true);
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
    if (!unknown.ok) expect(unknown.reason).toContain('Create account');
  });
});

describe('characters', () => {
  it('creates, lists and loads a character', async () => {
    const accountId = await register('Kain', 'secret123');
    const characterId = makeCharacter(accountId, 'Kain');

    const list = store.listCharacters(accountId);
    expect(list).toHaveLength(1);
    expect(list[0]?.name).toBe('Kain');
    expect(list[0]?.level).toBe(1);

    store.saveCharacter(characterId, sampleSave('Kain'));

    const save = store.loadCharacter(characterId);
    if (save === null) throw new Error('no character loaded');

    expect(save.name).toBe('Kain');
    expect(save.equipment.weapon).toBe('iron_sword');
    expect(save.equipment.armor).toBe('padded_armor');
    expect(save.level).toBe(5);
    expect(save.exp).toBe(20);
    expect(save.yang).toBe(300);
    expect(save.hp).toBe(70);
    expect(save.map).toBe('testmap');
    expect(save.x).toBeCloseTo(100.5, 3);
    expect(save.y).toBeCloseTo(200.25, 3);
    expect(save.dir).toBe(3);
    expect(save.inventory[0]).toEqual({ key: 'wolf_fur', count: 7 });
    expect(save.inventory[3]).toEqual({ key: 'boar_tusk', count: 1 });
    expect(save.inventory[1]).toBeNull();
  });

  it('keeps several characters apart', async () => {
    const accountId = await register('Kain', 'secret123');
    const first = makeCharacter(accountId, 'Kain');
    const second = makeCharacter(accountId, 'Lyra');

    store.saveCharacter(first, { ...sampleSave('Kain'), level: 5 });
    store.saveCharacter(second, { ...sampleSave('Lyra'), level: 9 });

    expect(store.loadCharacter(first)?.level).toBe(5);
    expect(store.loadCharacter(second)?.level).toBe(9);
    expect(store.listCharacters(accountId).map((entry) => entry.name)).toEqual(['Kain', 'Lyra']);
  });

  it('refuses more characters than the account has slots', async () => {
    const accountId = await register('Kain', 'secret123');
    for (let index = 0; index < MAX_CHARACTERS; index += 1) {
      makeCharacter(accountId, `Hero${index}`);
    }

    const extra = store.createCharacter(accountId, 'TooMany');
    expect(extra.ok).toBe(false);
  });

  it('refuses a character name that exists anywhere', async () => {
    const first = await register('Kain', 'secret123');
    const second = await register('Lyra', 'secret123');
    makeCharacter(first, 'Hero');

    const clash = store.createCharacter(second, 'Hero');
    expect(clash.ok).toBe(false);
  });

  it('knows which account a character belongs to', async () => {
    const first = await register('Kain', 'secret123');
    const second = await register('Lyra', 'secret123');
    const characterId = makeCharacter(first, 'Hero');

    expect(store.characterOwner(characterId)).toBe(first);
    expect(store.characterOwner(characterId)).not.toBe(second);
    expect(store.characterOwner(9999)).toBeNull();
  });

  it('replaces the old state completely on the next save', async () => {
    const accountId = await register('Kain', 'secret123');
    const characterId = makeCharacter(accountId, 'Kain');

    const first = emptyInventory();
    first[2] = { key: 'wolf_fur', count: 3 };
    store.saveCharacter(characterId, { ...sampleSave('Kain'), level: 1, inventory: first });

    const second = emptyInventory();
    second[0] = { key: 'boar_tusk', count: 2 };
    store.saveCharacter(characterId, { ...sampleSave('Kain'), level: 2, inventory: second });

    const save = store.loadCharacter(characterId);
    if (save === null) throw new Error('no character loaded');

    expect(save.level).toBe(2);
    expect(save.inventory[2]).toBeNull();
    expect(save.inventory[0]).toEqual({ key: 'boar_tusk', count: 2 });
  });
});
