// The inventory panel: worn equipment on top, bag slots below.
// Clicking a bag slot wears the item; clicking a worn piece takes it off.
// Hovering (or, on a phone, the first tap) shows what the item is and does.

import {
  INVENTORY_SLOTS,
  describeItem,
  itemDef,
  type Equipment,
  type InventorySlot,
} from '@lumiis/shared';
import { view } from '../state';

const mustFind = (id: string): HTMLElement => {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`missing element #${id}`);
  return element;
};

const escapeHtml = (text: string): string =>
  text.replace(/[&<>"]/g, (char) =>
    char === '&' ? '&amp;' : char === '<' ? '&lt;' : char === '>' ? '&gt;' : '&quot;',
  );

const mobile = (): boolean => document.body.classList.contains('mobile');

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
  const tip = mustFind('item-tip');

  /** The cell whose tooltip is open, so a second tap can act on it. */
  let tipCell: HTMLElement | null = null;

  const hideTip = (): void => {
    tipCell = null;
    tip.classList.add('hidden');
  };

  const showTip = (cell: HTMLElement, slot: InventorySlot, worn: boolean): void => {
    if (slot === null) {
      hideTip();
      return;
    }

    const info = describeItem(slot.key);
    const lines: string[] = [];

    lines.push(`<b class="tip-name">${escapeHtml(info.name)}</b>`);

    const shortOfLevel = info.level > 0 && view.self.level < info.level;
    const levelText = info.level > 0 ? ` · ab Level ${info.level}` : '';
    lines.push(
      `<small class="tip-type${shortOfLevel ? ' bad' : ''}">` +
        `${escapeHtml(info.typeName)}${levelText}${worn ? ' · angelegt' : ''}</small>`,
    );

    for (const stat of info.stats) {
      lines.push(`<span class="tip-stat">${escapeHtml(stat.label)} +${stat.value}</span>`);
    }

    if (info.desc !== '') lines.push(`<small class="tip-desc">${escapeHtml(info.desc)}</small>`);
    if (slot.count > 1) lines.push(`<small>Anzahl: ${slot.count}</small>`);

    const canWear = info.typeName !== 'Material';
    const hint = worn
      ? mobile()
        ? 'Nochmal tippen: ablegen'
        : 'Klicken: ablegen'
      : !canWear
        ? 'Material'
        : mobile()
          ? 'Nochmal tippen: anlegen'
          : 'Klicken: anlegen';
    lines.push(`<small class="tip-hint">${hint}</small>`);

    tip.innerHTML = lines.join('<br>');
    tip.classList.remove('hidden');
    tipCell = cell;

    // Place it beside the slot, but never off the screen.
    const cellBox = cell.getBoundingClientRect();
    const width = tip.offsetWidth;
    const height = tip.offsetHeight;
    let x = cellBox.right + 8;
    if (x + width > window.innerWidth - 4) x = cellBox.left - width - 8;
    let y = cellBox.top;
    if (y + height > window.innerHeight - 4) y = window.innerHeight - height - 4;
    tip.style.left = `${Math.max(4, x)}px`;
    tip.style.top = `${Math.max(4, y)}px`;
  };

  /** On a phone the first tap only explains; the second one acts. */
  const activate = (cell: HTMLElement, slot: InventorySlot, worn: boolean, action: () => void): void => {
    if (mobile() && slot !== null && tipCell !== cell) {
      showTip(cell, slot, worn);
      return;
    }
    hideTip();
    action();
  };

  const paint = (cell: HTMLElement, slot: InventorySlot): void => {
    cell.replaceChildren();
    if (slot === null) return;

    const def = itemDef(slot.key);
    if (def.icon !== undefined && def.icon !== '') {
      const icon = document.createElement('img');
      icon.className = 'slot-icon';
      icon.src = `/assets/icons/${def.icon}`;
      icon.alt = '';
      icon.draggable = false;
      cell.append(icon);
    } else {
      const dot = document.createElement('div');
      dot.className = 'slot-dot';
      dot.style.background = def.color;
      cell.append(dot);
    }

    if (slot.count > 1) {
      const count = document.createElement('span');
      count.className = 'slot-count';
      count.textContent = String(slot.count);
      cell.append(count);
    }
  };

  const cells: HTMLElement[] = [];
  const slots: InventorySlot[] = [];
  for (let index = 0; index < INVENTORY_SLOTS; index += 1) {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'slot';
    cell.addEventListener('click', () => {
      const slot = slots[index] ?? null;
      const wearable = slot !== null && itemDef(slot.key).slot !== undefined;
      if (slot === null) return;
      if (!wearable) {
        if (mobile()) showTip(cell, slot, false);
        return;
      }
      activate(cell, slot, false, () => onEquip(index));
    });
    grid.append(cell);
    cells.push(cell);
    slots.push(null);
  }

  let weapon: InventorySlot = null;
  let armor: InventorySlot = null;

  weaponCell.addEventListener('click', () => {
    activate(weaponCell, weapon, true, () => onUnequip('weapon'));
  });
  armorCell.addEventListener('click', () => {
    activate(armorCell, armor, true, () => onUnequip('armor'));
  });

  if (!mobile()) {
    const hover = (cell: HTMLElement, get: () => InventorySlot, worn: boolean): void => {
      cell.addEventListener('pointerenter', () => showTip(cell, get(), worn));
      cell.addEventListener('pointerleave', () => {
        if (tipCell === cell) hideTip();
      });
    };

    cells.forEach((cell, index) => hover(cell, () => slots[index] ?? null, false));
    hover(weaponCell, () => weapon, true);
    hover(armorCell, () => armor, true);
  }

  const toggle = (): void => {
    if (panel.classList.contains('hidden')) {
      const settingsPanel = document.getElementById('settings');
      if (settingsPanel !== null) settingsPanel.classList.add('hidden');
    }
    hideTip();
    panel.classList.toggle('hidden');
  };

  button.addEventListener('click', toggle);
  window.addEventListener('keydown', (event) => {
    if (event.code !== 'KeyI') return;
    event.preventDefault();
    toggle();
  });

  // A click anywhere else closes the tooltip; a click on its own slot reaches
  // the slot handler above first.
  document.addEventListener(
    'pointerdown',
    (event) => {
      const target = event.target as Node | null;
      if (target !== null && tipCell !== null && (tipCell === target || tipCell.contains(target))) {
        return;
      }
      hideTip();
    },
    true,
  );

  let signature = '';

  return {
    render(nextSlots: InventorySlot[], equipment: Equipment): void {
      const next = [
        ...nextSlots.map((slot) => (slot === null ? '' : `${slot.key}:${slot.count}`)),
        `${equipment.weapon ?? ''}/${equipment.armor ?? ''}`,
      ].join('|');
      if (next === signature) return;
      signature = next;

      for (let index = 0; index < cells.length; index += 1) {
        const cell = cells[index];
        if (cell === undefined) continue;

        const slot = nextSlots[index] ?? null;
        slots[index] = slot;
        paint(cell, slot);
        cell.classList.toggle('filled', slot !== null && itemDef(slot.key).slot !== undefined);
      }

      weapon = equipment.weapon === null ? null : { key: equipment.weapon, count: 1 };
      armor = equipment.armor === null ? null : { key: equipment.armor, count: 1 };
      paint(weaponCell, weapon);
      paint(armorCell, armor);
      weaponCell.classList.toggle('filled', weapon !== null);
      armorCell.classList.toggle('filled', armor !== null);

      // A repaint invalidates an open tooltip.
      if (tipCell !== null) hideTip();
    },
  };
}
