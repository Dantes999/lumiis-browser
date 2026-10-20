// Pickup settings: automatic collection and which item types it may take.
// Stored in the browser and sent to the server, which is the one that collects.

import { ITEM_KEYS, ITEMS } from '@lumiis/shared';

export type PickupSettings = {
  autoPickup: boolean;
  /** Item types auto pickup may take. An empty list takes nothing. */
  types: string[];
};

const STORAGE_KEY = 'lumiis.pickup';

const mustFind = (id: string): HTMLElement => {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`missing element #${id}`);
  return element;
};

const load = (): PickupSettings => {
  try {
    const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null') as unknown;
    if (typeof raw !== 'object' || raw === null) return { autoPickup: false, types: [...ITEM_KEYS] };

    const stored = raw as { autoPickup?: unknown; types?: unknown };
    const types = Array.isArray(stored.types)
      ? stored.types.filter((entry): entry is string => typeof entry === 'string')
      : [...ITEM_KEYS];

    return { autoPickup: stored.autoPickup === true, types };
  } catch {
    return { autoPickup: false, types: [...ITEM_KEYS] };
  }
};

export type Settings = {
  current(): PickupSettings;
};

export function createSettings(onChange: (settings: PickupSettings) => void): Settings {
  const panel = mustFind('settings');
  const toggleButton = mustFind('settings-toggle');
  const auto = mustFind('auto-pickup') as HTMLInputElement;
  const filter = mustFind('pickup-filter');

  let settings = load();

  const save = (): void => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Private mode: the settings simply are not remembered.
    }
  };

  const push = (): void => {
    save();
    onChange(settings);
  };

  const boxes = ITEM_KEYS.map((key) => {
    const row = document.createElement('label');
    row.className = 'filter-row';

    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = settings.types.includes(key);

    const dot = document.createElement('span');
    dot.className = 'filter-dot';
    dot.style.background = ITEMS[key].color;

    const name = document.createElement('span');
    name.textContent = ITEMS[key].name;

    row.append(box, dot, name);
    filter.append(row);
    return { key, box };
  });

  auto.checked = settings.autoPickup;

  auto.addEventListener('change', () => {
    settings = { ...settings, autoPickup: auto.checked };
    push();
  });

  for (const { key, box } of boxes) {
    box.addEventListener('change', () => {
      const types = boxes.filter((entry) => entry.box.checked).map((entry) => entry.key);
      settings = { ...settings, types };
      push();
    });
  }

  const toggle = (): void => {
    if (panel.classList.contains('hidden')) {
      mustFind('bag').classList.add('hidden');
    }
    panel.classList.toggle('hidden');
  };

  toggleButton.addEventListener('click', toggle);
  window.addEventListener('keydown', (event) => {
    if (event.code !== 'KeyO') return;
    event.preventDefault();
    toggle();
  });

  return {
    current: () => settings,
  };
}
