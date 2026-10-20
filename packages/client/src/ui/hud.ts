// Plain DOM for the interface. Phaser draws the world; HTML draws the rest,
// because that is what scales from desktop to phone without extra work.

import { PLAYER_DAMAGE, expForNextLevel, itemDef } from '@lumiis/shared';
import { playerCount, type ViewState } from '../state';

const mustFind = (id: string): HTMLElement => {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`missing element #${id}`);
  return element;
};

const shareOf = (value: number, max: number): number =>
  max <= 0 ? 0 : Math.max(0, Math.min(1, value / max));

export type Hud = {
  render(state: ViewState): void;
};

export function createHud(): Hud {
  const status = mustFind('status');
  const tick = mustFind('tick');
  const ping = mustFind('ping');
  const players = mustFind('players');
  const level = mustFind('level');
  const hp = mustFind('hp');
  const hpFill = mustFind('hp-fill');
  const exp = mustFind('exp');
  const expFill = mustFind('exp-fill');
  const yang = mustFind('yang');
  const attack = mustFind('attack');
  const defence = mustFind('defence');

  return {
    render(state: ViewState): void {
      const dead = state.self.hp <= 0;
      const noticeFresh = state.notice !== null && performance.now() < state.noticeUntil;

      status.textContent = dead
        ? 'down'
        : noticeFresh
          ? state.notice ?? state.status
          : state.status;

      tick.textContent = String(state.tick);
      ping.textContent = state.pingMs === null ? '–' : `${state.pingMs} ms`;
      players.textContent = String(playerCount());

      level.textContent = String(state.self.level);
      yang.textContent = String(state.self.yang);

      const weapon = state.equipment.weapon === null ? null : itemDef(state.equipment.weapon);
      const armor = state.equipment.armor === null ? null : itemDef(state.equipment.armor);
      attack.textContent = String(PLAYER_DAMAGE + (weapon?.attack ?? 0));
      defence.textContent = String(armor?.defense ?? 0);

      const hpShare = shareOf(state.self.hp, state.self.maxHp);
      hp.textContent = `${Math.max(0, Math.round(state.self.hp))} / ${state.self.maxHp}`;
      hpFill.style.width = `${hpShare * 100}%`;
      hpFill.classList.toggle('low', hpShare <= 0.3);

      const next = expForNextLevel(state.self.level);
      const expShare = Number.isFinite(next) ? shareOf(state.self.exp, next) : 1;
      exp.textContent = Number.isFinite(next)
        ? `${state.self.exp} / ${next}`
        : `${state.self.exp}`;
      expFill.style.width = `${expShare * 100}%`;
    },
  };
}
