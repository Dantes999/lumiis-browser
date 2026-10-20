// Plain DOM for the interface. Phaser draws the world; HTML draws the rest,
// because that is what scales from desktop to phone without extra work.

import type { ViewState } from '../state';

const mustFind = (id: string): HTMLElement => {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`missing element #${id}`);
  return element;
};

export type Hud = {
  render(state: ViewState): void;
};

export function createHud(): Hud {
  const status = mustFind('status');
  const tick = mustFind('tick');
  const ping = mustFind('ping');
  const players = mustFind('players');

  return {
    render(state: ViewState): void {
      status.textContent = state.notice === null ? state.status : `${state.status} – ${state.notice}`;
      tick.textContent = String(state.tick);
      ping.textContent = state.pingMs === null ? '–' : `${state.pingMs} ms`;
      players.textContent = String(state.players.length);
    },
  };
}
