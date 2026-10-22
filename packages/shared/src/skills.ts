// Skills: the special moves a player can fire on top of the normal swing.
//
// Two for now: a self-buff and a whirlwind that hits everything around the
// player. They run on a cooldown only; mana comes later if it is wanted.

export type SkillKey = 'aura' | 'whirlwind';

export type SkillDef = {
  key: SkillKey;
  /** German name shown on the button and in tooltips. */
  name: string;
  kind: 'buff' | 'aoe';
  /** Cooldown in ticks (20 per second). */
  cooldownTicks: number;
  /** Skill points one cast costs. */
  spCost: number;
  /** Which attack value the damage is built from. */
  scaling: 'physical' | 'magical';
  /** Buff only: how long the effect lasts, in ticks. */
  durationTicks?: number;
  /** Buff only: flat attack added while the effect runs. */
  attackBonus?: number;
  /** AoE only: radius in pixels, measured at the feet. */
  radius?: number;
  /** AoE only: damage as a multiple of the normal attack. */
  damageScale?: number;
};

/** EIGENE WAHL: values are placeholders until balance is tuned with bots. */
export const SKILLS: Record<SkillKey, SkillDef> = {
  aura: {
    key: 'aura',
    name: 'Aura',
    kind: 'buff',
    cooldownTicks: 200,
    spCost: 10,
    scaling: 'physical',
    durationTicks: 200,
    attackBonus: 10,
  },
  whirlwind: {
    key: 'whirlwind',
    name: 'Schwertwirbel',
    kind: 'aoe',
    cooldownTicks: 60,
    spCost: 15,
    scaling: 'physical',
    radius: 64,
    damageScale: 1.5,
  },
};

export const SKILL_KEYS = Object.keys(SKILLS) as SkillKey[];

export const isSkillKey = (value: unknown): value is SkillKey =>
  typeof value === 'string' && Object.hasOwn(SKILLS, value);
