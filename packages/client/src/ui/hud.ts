// Plain DOM for the interface. Phaser draws the world; HTML draws the rest,
// because that is what scales from desktop to phone without extra work.

import { playerCount, type ViewState } from '../state';

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
  const hp = mustFind('hp');
  const hpFill = mustFind('hp-fill');

  return {
    render(state: ViewState): void {
      const dead = state.self.hp <= 0;
      status.textContent = dead
        ? 'down'
        : state.notice === null
          ? state.status
          : `${state.status} – ${state.notice}`;

      tick.textContent = String(state.tick);
      ping.textContent = state.pingMs === null ? '–' : `${state.pingMs} ms`;
      players.textContent = String(playerCount());

      hp.textContent = `${Math.max(0, Math.round(state.self.hp))} / ${state.self.maxHp}`;
      const share = state.self.maxHp === 0 ? 0 : state.self.hp / state.self.maxHp;
      hpFill.style.width = `${Math.max(0, Math.min(1, share)) * 100}%`;
      hpFill.classList.toggle('low', share <= 0.3);
    },
  };
}
