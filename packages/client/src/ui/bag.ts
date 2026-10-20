// The inventory panel: worn equipment on top, bag slots below.
// Clicking a bag slot wears the item; clicking a worn piece takes it off.

import { INVENTORY_SLOTS, itemDef, type Equipment, type InventorySlot } from '@lumiis/shared';

const mustFind = (id: string): HTMLElement => {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`missing element #${id}`);
  return element;
};

const paint = (cell: HTMLElement, slot: InventorySlot): void => {
  cell.replaceChildren();
  cell.title = '';

  if (slot === null) return;

  const dot = document.createElement('div');
  dot.className = 'slot-dot';
  dot.style.background = itemDef(slot.key).color;
  cell.append(dot);

  if (slot.count > 1) {
    const count = document.createElement('span');
    count.className = 'slot-count';
    count.textContent = String(slot.count);
    cell.append(count);
  }

  cell.title = itemDef(slot.key).name;
};

export type Bag = {
  render(slots: InventorySlot[], equipment: Equipment): void;
};

export function createBag(
  onEquip: (slot: number) => void,
  onUnequip: (piece: 'weapon' | 'armor') => void,
): Bag {
  const panel = mustFind('bag');
  const grid = mustFind('bag-grid');
  const button = mustFind('bag-toggle');
  const weaponCell = mustFind('equip-weapon');
  const armorCell = mustFind('equip-armor');

  const cells: HTMLElement[] = [];
  for (let index = 0; index < INVENTORY_SLOTS; index += 1) {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'slot';
    cell.addEventListener('click', () => {
      if (cell.classList.contains('filled')) onEquip(index);
    });
    grid.append(cell);
    cells.push(cell);
  }

  weaponCell.addEventListener('click', () => {
    if (weaponCell.classList.contains('filled')) onUnequip('weapon');
  });
  armorCell.addEventListener('click', () => {
    if (armorCell.classList.contains('filled')) onUnequip('armor');
  });

  const toggle = (): void => {
    if (panel.classList.contains('hidden')) {
      const settingsPanel = document.getElementById('settings');
      if (settingsPanel !== null) settingsPanel.classList.add('hidden');
    }
    panel.classList.toggle('hidden');
  };

  button.addEventListener('click', toggle);
  window.addEventListener('keydown', (event) => {
    if (event.code !== 'KeyI') return;
    event.preventDefault();
    toggle();
  });

  let signature = '';

  return {
    render(slots: InventorySlot[], equipment: Equipment): void {
      const next = [
        ...slots.map((slot) => (slot === null ? '' : `${slot.key}:${slot.count}`)),
        `${equipment.weapon ?? ''}/${equipment.armor ?? ''}`,
      ].join('|');
      if (next === signature) return;
      signature = next;

      for (let index = 0; index < cells.length; index += 1) {
        const cell = cells[index];
        if (cell === undefined) continue;

        const slot = slots[index] ?? null;
        paint(cell, slot);
        cell.classList.toggle('filled', slot !== null && itemDef(slot.key).slot !== undefined);
      }

      paint(
        weaponCell,
        equipment.weapon === null ? null : { key: equipment.weapon, count: 1 },
      );
      weaponCell.classList.toggle('filled', equipment.weapon !== null);

      paint(armorCell, equipment.armor === null ? null : { key: equipment.armor, count: 1 });
      armorCell.classList.toggle('filled', equipment.armor !== null);
    },
  };
}
