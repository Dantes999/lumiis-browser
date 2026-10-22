// Plain DOM for the interface. Phaser draws the world; HTML draws the rest,
// because that is what scales from desktop to phone without extra work.

import {
  PLAYER_DAMAGE,
  SKILLS,
  SKILL_KEYS,
  STAT_ATTACK_PER_STR,
  STAT_DEFENSE_PER_DEX,
  expForNextLevel,
  itemDef,
} from '@lumiis/shared';
import { cooldownFraction } from '../skill';
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

export function createHud(
  onSkill?: (slot: number) => void,
  onPotion?: (kind: 'hp' | 'sp') => void,
): Hud {
  const status = mustFind('status');
  const tick = mustFind('tick');
  const ping = mustFind('ping');
  const players = mustFind('players');
  const level = mustFind('level');
  const hp = mustFind('hp');
  const hpFill = mustFind('hp-fill');
  const sp = mustFind('sp');
  const spFill = mustFind('sp-fill');
  const exp = mustFind('exp');
  const expFill = mustFind('exp-fill');
  const yang = mustFind('yang');
  const attack = mustFind('attack');
  const defence = mustFind('defence');
  const buffs = mustFind('buffs');
  const potionHp = mustFind('potion-hp');
  const potionSp = mustFind('potion-sp');
  const potionHpCount = potionHp.querySelector<HTMLElement>('.potion-count');
  const potionSpCount = potionSp.querySelector<HTMLElement>('.potion-count');

  potionHp.addEventListener('click', () => onPotion?.('hp'));
  potionSp.addEventListener('click', () => onPotion?.('sp'));

  const skillButtons = SKILL_KEYS.map((key, slot) => {
    const button = mustFind(`skill-${slot}`);
    const name = button.querySelector<HTMLElement>('.skill-name');
    if (name !== null) name.textContent = SKILLS[key].name;
    button.addEventListener('click', () => onSkill?.(slot));
    return {
      key,
      button,
      cooldown: button.querySelector<HTMLElement>('.skill-cd'),
    };
  });

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
      const aura = state.self.buffs['aura'] !== undefined ? SKILLS.aura.attackBonus ?? 0 : 0;
      attack.textContent = String(
        PLAYER_DAMAGE + (weapon?.attack ?? 0) + aura + state.self.stats.str * STAT_ATTACK_PER_STR,
      );
      defence.textContent = String(
        (armor?.defense ?? 0) + Math.floor(state.self.stats.dex / STAT_DEFENSE_PER_DEX),
      );

      // Cooldown veil on the skill buttons.
      for (const entry of skillButtons) {
        const left = cooldownFraction(entry.key);
        if (entry.cooldown !== null) {
          entry.cooldown.style.transform = `scaleY(${left})`;
        }
        entry.button.classList.toggle('cooling', left > 0);
      }

      // Active buffs as small chips with their remaining time.
      const active = Object.entries(state.self.buffs).filter(([, seconds]) => seconds > 0);
      buffs.replaceChildren(
        ...active.map(([key, seconds]) => {
          const chip = document.createElement('span');
          chip.className = 'buff';
          const name = key in SKILLS ? SKILLS[key as keyof typeof SKILLS].name : key;
          chip.textContent = `${name} ${Math.ceil(seconds)}s`;
          return chip;
        }),
      );

      const hpShare = shareOf(state.self.hp, state.self.maxHp);
      hp.textContent = `${Math.max(0, Math.round(state.self.hp))} / ${state.self.maxHp}`;
      hpFill.style.width = `${hpShare * 100}%`;
      hpFill.classList.toggle('low', hpShare <= 0.3);

      const spShare = shareOf(state.self.sp, state.self.maxSp);
      sp.textContent = `${Math.max(0, Math.round(state.self.sp))} / ${state.self.maxSp}`;
      spFill.style.width = `${spShare * 100}%`;

      const countOf = (key: string): number =>
        state.inventory.reduce(
          (sum, slot) => (slot !== null && slot.key === key ? sum + slot.count : sum),
          0,
        );
      if (potionHpCount !== null) potionHpCount.textContent = String(countOf('small_hp_potion'));
      if (potionSpCount !== null) potionSpCount.textContent = String(countOf('small_sp_potion'));

      const next = expForNextLevel(state.self.level);
      const expShare = Number.isFinite(next) ? shareOf(state.self.exp, next) : 1;
      exp.textContent = Number.isFinite(next)
        ? `${state.self.exp} / ${next}`
        : `${state.self.exp}`;
      expFill.style.width = `${expShare * 100}%`;
    },
  };
}
