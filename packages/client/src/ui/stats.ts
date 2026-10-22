// The stat window: spend the points a level up hands out.
//
// Four rows, one plus button each; the values come from the server snapshot, so
// the window never shows a number the server does not agree with. The effect
// (more health, more skill points, harder hits, better defence) is applied on
// the server and shows in the HUD on the next snapshot.

import { CLASSES, STAT_KEYS, type StatKey } from '@lumiis/shared';
import { view } from '../state';

const mustFind = (id: string): HTMLElement => {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`missing element #${id}`);
  return element;
};

const LABELS: Record<StatKey, string> = {
  str: 'Stärke',
  vit: 'Vitalität',
  int: 'Intelligenz',
  dex: 'Geschick',
};

const HINTS: Record<StatKey, string> = {
  str: 'mehr Angriff',
  vit: 'mehr TP',
  int: 'mehr SP',
  dex: 'mehr Verteidigung',
};

export type StatsPanel = {
  render(): void;
};

export function createStatsPanel(onSpend: (stat: StatKey) => void): StatsPanel {
  const panel = mustFind('stats');
  const toggle = mustFind('stats-toggle');
  const close = mustFind('stats-close');
  const points = mustFind('stats-points');
  const className = mustFind('stats-class');
  const rows = mustFind('stats-rows');
  const derived = {
    attack: mustFind('derived-atk'),
    matk: mustFind('derived-matk'),
    defense: mustFind('derived-def'),
    mdef: mustFind('derived-mdef'),
  };

  const values = new Map<StatKey, HTMLElement>();
  const buttons = new Map<StatKey, HTMLButtonElement>();

  for (const key of STAT_KEYS) {
    const row = document.createElement('div');
    row.className = 'stats-row';

    const name = document.createElement('span');
    name.className = 'stats-name';
    name.textContent = LABELS[key];
    name.title = HINTS[key];

    const value = document.createElement('span');
    value.className = 'stats-value';
    value.textContent = '0';
    values.set(key, value);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'stats-plus';
    button.textContent = '+';
    button.title = `${LABELS[key]} erhöhen (${HINTS[key]})`;
    button.addEventListener('click', () => onSpend(key));
    buttons.set(key, button);

    row.append(name, value, button);
    rows.append(row);
  }

  toggle.addEventListener('click', () => {
    mustFind('bag').classList.add('hidden');
    panel.classList.toggle('hidden');
    render();
  });
  close.addEventListener('click', () => panel.classList.add('hidden'));

  function render(): void {
    className.textContent = CLASSES[view.self.cls]?.name ?? '';
    derived.attack.textContent = String(view.self.attack);
    derived.matk.textContent = String(view.self.matk);
    derived.defense.textContent = String(view.self.defense);
    derived.mdef.textContent = String(view.self.mdef);
    points.textContent = String(view.self.points);
    for (const key of STAT_KEYS) {
      const value = values.get(key);
      if (value !== undefined) value.textContent = String(view.self.stats[key]);
      const button = buttons.get(key);
      if (button !== undefined) button.disabled = view.self.points <= 0;
    }
  }

  render();
  return { render };
}
