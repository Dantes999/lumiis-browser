// The inventory panel: a plain grid of slots, filled from the server's slots.
// Colours stand in for icons until the real item artwork is ported.

import { INVENTORY_SLOTS, ITEMS, type InventorySlot } from '@lumiis/shared';

const mustFind = (id: string): HTMLElement => {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`missing element #${id}`);
  return element;
};

export type Bag = {
  render(slots: InventorySlot[]): void;
};

export function createBag(): Bag {
  const panel = mustFind('bag');
  const grid = mustFind('bag-grid');
  const button = mustFind('bag-toggle');

  const cells: HTMLElement[] = [];
  for (let index = 0; index < INVENTORY_SLOTS; index += 1) {
    const cell = document.createElement('div');
    cell.className = 'slot';
    grid.append(cell);
    cells.push(cell);
  }

  const toggle = (): void => {
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
    render(slots: InventorySlot[]): void {
      const next = slots.map((slot) => (slot === null ? '' : `${slot.key}:${slot.count}`)).join('|');
      if (next === signature) return;
      signature = next;

      for (let index = 0; index < cells.length; index += 1) {
        const cell = cells[index];
        if (cell === undefined) continue;

        const slot = slots[index] ?? null;
        cell.replaceChildren();
        cell.title = '';

        if (slot === null) continue;

        const dot = document.createElement('div');
        dot.className = 'slot-dot';
        dot.style.background = ITEMS[slot.key]?.color ?? '#ffffff';
        cell.append(dot);

        if (slot.count > 1) {
          const count = document.createElement('span');
          count.className = 'slot-count';
          count.textContent = String(slot.count);
          cell.append(count);
        }

        cell.title = ITEMS[slot.key]?.name ?? slot.key;
      }
    },
  };
}
