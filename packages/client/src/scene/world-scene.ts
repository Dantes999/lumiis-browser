// The world view: tilemap, players, camera.
// Positions come from the simulation; the server is the final word.

import Phaser from 'phaser';
import {
  ITEMS,
  isItemKey,
  MONSTER_KEYS,
  MONSTER_TYPES,
  TILE_SIZE,
  DIR_VECTORS,
  mapPixelHeight,
  mapPixelWidth,
  swingFor,
  swingMs,
  validateMap,
  type Direction,
  type ItemKey,
  type MapData,
} from '@lumiis/shared';
import { sfx } from '../audio';
import {
  PlayerView,
  activePack,
  readTables,
  spriteSheets,
  type ArtTables,
  type StylePack,
} from '../art';
import { attackPose, heldAttack } from '../combat';
import { MOB_CELL_H, MOB_CELL_W, MonsterView } from '../mobart';
import { renderedSelfPosition, stepLocal } from '../sim';
import { view, type RemotePlayer } from '../state';
import { buildTilesetTexture } from '../tiles';
import { setWorldMap } from '../world-map';
import { SwingTrail } from './swing-trail';
import { WhirlwindEffect } from './skill-effects';
import { setSkillVisual } from '../skill';
import { setRewardHandler } from '../net';
import { RewardOrb } from './reward-orbs';
import { aimDirection, aimPoint, setAimPointer } from '../aim';

/** Milliseconds per walking frame. */
const STEP_FRAME_MS = 180;
/** The three columns of a swing: out, through, back. */
const SWING_COLUMNS = [4, 5, 6] as const;

/** Maps swing progress (0..1) to a column: held wind-up, fast strike, ease out. */
const swingColumn = (progress: number): number => {
  if (progress < 0.42) return SWING_COLUMNS[0];
  if (progress < 0.6) return SWING_COLUMNS[1];
  return SWING_COLUMNS[2];
};

/** Body tilt through a swing: cock back, commit, ease out. */
const swingLean = (progress: number, sweep: 1 | -1): number => {
  if (progress < 0.42) {
    const t = progress / 0.42;
    return sweep * -0.07 * Math.sin((t * Math.PI) / 2);
  }
  if (progress < 0.6) {
    const t = (progress - 0.42) / 0.18;
    return sweep * (-0.07 + 0.11 * t);
  }
  const t = (progress - 0.6) / 0.4;
  return sweep * 0.04 * (1 - t);
};

/** Progress of a swing given its start and duration, clamped to 0..1. */
const swingProgress = (startedAt: number, durationMs: number, now: number): number =>
  Math.min(1, Math.max(0, (now - startedAt) / durationMs));
/** Time constant for other players catching up to their reported position. */
const OTHERS_TAU_MS = 60;

export class WorldScene extends Phaser.Scene {
  private tables: ArtTables | null = null;
  private pack: StylePack | null = null;
  private readonly views = new Map<number, PlayerView>();
  private readonly monsterViews = new Map<number, MonsterView>();
  private readonly groundViews = new Map<number, Phaser.GameObjects.Container>();
  private following = false;
  private appliedZoom = 0;
  private mapId: string | null = null;
  private layer: Phaser.Tilemaps.TilemapLayer | null = null;
  private lastSelfHp = -1;
  /** The streak of the last swing this client drew, to notice a new one. */
  private shownSwingAt = 0;
  /** Running whirlwind effects. */
  private readonly whirlwinds: WhirlwindEffect[] = [];
  /** Players whose whirlwind is already being shown. */
  private readonly whirlwindShown = new Set<number>();
  /** Experience orbs flying from dead monsters to the players who earned them. */
  private readonly orbs: RewardOrb[] = [];
  /** The pulsing ring at the feet while the aura buff is up. */
  private auraRing: Phaser.GameObjects.Graphics | null = null;
  /** The ground arrow that shows where a mouse-aimed swing will go. */
  private aimArrow: Phaser.GameObjects.Graphics | null = null;
  private readonly trails: SwingTrail[] = [];
  /** For other players: when their last seen swing ended, and how many they did. */
  private readonly seenSwings = new Map<number, number>();
  private readonly swingCounts = new Map<number, number>();
  private flashUntil = 0;
  /** Camera shake: the moment it ends and how hard it was. */
  private shakeUntil = 0;
  private shakePower = 0;
  /** Monsters flashing white after a hit, keyed by id. */
  private readonly monsterFlashUntil = new Map<number, number>();
  /** Monsters already in their death fade, keyed by id. */
  private readonly deadMonsters = new Set<number>();
  private lastLevel = -1;
  private lastItemCount = -1;
  private readonly lastMonsterHp = new Map<number, number>();

  constructor() {
    super('world');
  }

  preload(): void {
    // The graphic style decides the cell size, the sheet paths and the row table.
    const chosen = activePack();
    this.pack = chosen.pack;
    console.info(`style pack: ${chosen.id} (${chosen.pack.name})`);

    if (chosen.pack.rows !== undefined) this.load.json('rows_style', chosen.pack.rows);

    const grid = { frameWidth: chosen.pack.cell, frameHeight: chosen.pack.cell };
    for (const sheet of spriteSheets(chosen.pack)) {
      this.load.spritesheet(sheet.key, sheet.path, grid);
    }

    // One sheet per monster type, 40x32 cells, four views of five frames.
    for (const key of MONSTER_KEYS) {
      this.load.spritesheet(
        `mob_${key}`,
        `/assets/monster/${MONSTER_TYPES[key].look}.png`,
        { frameWidth: MOB_CELL_W, frameHeight: MOB_CELL_H },
      );
    }
  }

  create(): void {
    this.tables = readTables(this, this.pack ?? undefined);
    this.cameras.main.setBackgroundColor('#0b0f13');
    buildTilesetTexture(this);

    this.auraRing = this.add.graphics();
    this.auraRing.setDepth(1);

    this.aimArrow = this.add.graphics();
    this.aimArrow.setDepth(1);
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      const point = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      setAimPointer(point.x, point.y);
    });

    setSkillVisual((key) => {
      if (key === 'whirlwind') this.spawnWhirlwind();
    });

    // A kill: one orb per player, sized by their share of the damage.
    setRewardHandler((reward) => {
      for (const share of reward.shares) {
        const target =
          share.id === view.selfId
            ? () => renderedSelfPosition()
            : () => {
                const other = view.others.get(share.id);
                return other === undefined ? null : { x: other.renderX, y: other.renderY };
              };
        this.orbs.push(new RewardOrb(this, { x: reward.x, y: reward.y }, target, share.exp));
      }
    });

    // One soft dot, reused for the sparks a hit throws out.
    const spark = this.add.graphics();
    spark.fillStyle(0xffffff, 1);
    spark.fillCircle(3, 3, 3);
    spark.generateTexture('spark', 6, 6);
    spark.destroy();
  }

  /** Loads and builds the map the server put us on, and swaps it on a portal. */
  private syncMap(): void {
    const id = view.mapId;
    if (id === null || id === this.mapId) return;

    this.mapId = id;
    void this.loadMap(id);
  }

  private async loadMap(id: string): Promise<void> {
    const response = await fetch(`/maps/${id}.json`, { cache: 'no-store' });
    const check = validateMap(await response.json());

    if (!check.ok) {
      console.error(`map ${id} is invalid:`, check.errors);
      return;
    }

    const map = check.map;
    setWorldMap(map);

    this.layer?.destroy();
    this.layer = this.addTileLayer(map);

    this.cameras.main.setBounds(0, 0, mapPixelWidth(map), mapPixelHeight(map));
    if (!this.following) {
      this.cameras.main.centerOn(mapPixelWidth(map) / 2, mapPixelHeight(map) / 2);
    }
  }

  override update(_time: number, delta: number): void {
    heldAttack();
    this.syncMap();
    this.applyZoom();
    stepLocal(delta);
    this.renderGround();
    this.renderMonsters(delta);
    this.renderPlayers(delta);
    this.renderTrails(delta);
    this.updateWhirlwinds(delta);
    this.updateOrbs(delta);
    this.drawAuraRings();
    this.drawAimArrow();
    this.updateShake();
    this.watchInventory();
  }

  /** A small arrow at the feet pointing where the next mouse-aimed swing goes. */
  private drawAimArrow(): void {
    const arrow = this.aimArrow;
    if (arrow === null) return;
    arrow.clear();

    const point = aimPoint();
    const dir = aimDirection();
    if (point === null || dir === null) return;

    const vector = DIR_VECTORS[dir];
    if (vector === undefined) return;

    const feet = renderedSelfPosition();
    const angle = Math.atan2(vector[1], vector[0]);
    const length = 26;
    const baseLength = length - 12;
    const side = 8;

    const tipX = feet.x + Math.cos(angle) * length;
    const tipY = feet.y + Math.sin(angle) * length - 2;
    const baseX = feet.x + Math.cos(angle) * baseLength;
    const baseY = feet.y + Math.sin(angle) * baseLength - 2;
    const leftX = baseX + Math.cos(angle - Math.PI / 2) * side;
    const leftY = baseY + Math.sin(angle - Math.PI / 2) * side;
    const rightX = baseX + Math.cos(angle + Math.PI / 2) * side;
    const rightY = baseY + Math.sin(angle + Math.PI / 2) * side;

    arrow.setDepth(Math.round(feet.y) - 1);
    arrow.lineStyle(2, 0xffd479, 0.5);
    arrow.lineBetween(feet.x, feet.y - 2, baseX, baseY);
    arrow.fillStyle(0xffd479, 0.8);
    arrow.fillTriangle(tipX, tipY, leftX, leftY, rightX, rightY);
  }

  private updateOrbs(delta: number): void {
    for (let index = this.orbs.length - 1; index >= 0; index -= 1) {
      const orb = this.orbs[index];
      if (orb === undefined) continue;
      orb.update(delta);
      if (!orb.done) continue;
      orb.destroy();
      this.orbs.splice(index, 1);
    }
  }

  /** A pulsing ring at the feet of everyone with the aura buff. */
  private drawAuraRings(): void {
    const ring = this.auraRing;
    if (ring === null) return;
    ring.clear();
    ring.setDepth(1);

    const pulse = 0.5 + 0.5 * Math.sin(this.time.now / 170);
    const stroke = (x: number, y: number): void => {
      ring.lineStyle(2, 0x7fd4ff, 0.35 + pulse * 0.35);
      ring.strokeEllipse(x, y - 2, 34 + pulse * 6, 13 + pulse * 3);
    };

    if ((view.self.buffs['aura'] ?? 0) > 0 && view.selfId !== null) {
      const position = renderedSelfPosition();
      stroke(position.x, position.y);
    }
    for (const player of view.others.values()) {
      if ((player.buffs['aura'] ?? 0) > 0) stroke(player.renderX, player.renderY);
    }
  }

  /** The whirlwind spins around the caster for a moment. */
  private spawnWhirlwind(): void {
    this.whirlwinds.push(
      new WhirlwindEffect(this, () => renderedSelfPosition(), swingFor(view.equipment.weapon).range + 10),
    );
  }

  private updateWhirlwinds(delta: number): void {
    for (let index = this.whirlwinds.length - 1; index >= 0; index -= 1) {
      const effect = this.whirlwinds[index];
      if (effect === undefined) continue;
      effect.update(delta);
      if (!effect.done) continue;
      effect.destroy();
      this.whirlwinds.splice(index, 1);
    }
  }

  /** A short, decaying jolt for the camera after a blow. */
  private updateShake(): void {
    if (this.time.now < this.shakeUntil) {
      const remaining = (this.shakeUntil - this.time.now) / 90;
      const amplitude = this.shakePower * remaining;
      this.cameras.main.setFollowOffset(
        (Math.random() * 2 - 1) * amplitude,
        (Math.random() * 2 - 1) * amplitude,
      );
    } else if (this.cameras.main.followOffset.x !== 0 || this.cameras.main.followOffset.y !== 0) {
      this.cameras.main.setFollowOffset(0, 0);
    }
  }

  private triggerShake(power: number): void {
    this.shakeUntil = this.time.now + 90;
    this.shakePower = power;
  }

  /** A small shower of sparks where a blade connected. */
  private burstAt(x: number, y: number): void {
    const emitter = this.add.particles(x, y, 'spark', {
      speed: { min: 40, max: 150 },
      angle: { min: 0, max: 360 },
      lifespan: { min: 140, max: 300 },
      scale: { start: 1, end: 0 },
      tint: [0xffffff, 0xffe9a8, 0xffd479],
      blendMode: Phaser.BlendModes.ADD,
      emitting: false,
    });
    emitter.explode(12);
    this.time.delayedCall(350, () => emitter.destroy());
  }

  /** Starts the streak for a new swing and lets the running ones fade out. */
  private renderTrails(delta: number): void {
    const shown = attackPose();
    if (shown !== null && shown.startedAt !== this.shownSwingAt) {
      this.shownSwingAt = shown.startedAt;
      // Bare hands leave no blade streak; only a real weapon draws one.
      if (view.equipment.weapon !== null) {
        const reach = swingFor(view.equipment.weapon).range;
        this.trails.push(
          new SwingTrail(this, () => renderedSelfPosition(), shown.dir, shown.sweep, shown.durationMs, reach),
        );
      }
    }

    for (const [id, player] of view.others) {
      const ended = this.seenSwings.get(id) ?? 0;
      if (player.attackUntil > this.time.now && ended <= this.time.now) {
        const count = (this.swingCounts.get(id) ?? 0) + 1;
        this.swingCounts.set(id, count);
        if (!isItemKey(player.weapon)) continue;
        const reach = swingFor(player.weapon).range;
        const follow = player;
        this.trails.push(
          new SwingTrail(
            this,
            () => ({ x: follow.renderX, y: follow.renderY }),
            player.dir,
            count % 2 === 0 ? -1 : 1,
            swingMs(swingFor(isItemKey(player.weapon) ? player.weapon : null)),
            reach,
          ),
        );
      }
      if (player.attackUntil > ended) this.seenSwings.set(id, player.attackUntil);
    }

    for (let index = this.trails.length - 1; index >= 0; index -= 1) {
      const trail = this.trails[index];
      if (trail === undefined) continue;
      trail.update(delta);
      if (!trail.done) continue;
      trail.destroy();
      this.trails.splice(index, 1);
    }
  }

  /** A rising number where the hit landed. */
  private showDamage(x: number, y: number, amount: number, color: string): void {
    const text = this.add
      .text(Math.round(x), Math.round(y), `-${Math.round(amount)}`, {
        fontFamily: 'ui-monospace, monospace',
        fontSize: '11px',
        color,
      })
      .setOrigin(0.5)
      .setDepth(20000);

    this.tweens.add({
      targets: text,
      y: Math.round(y) - 22,
      alpha: 0,
      duration: 650,
      onComplete: () => text.destroy(),
    });
  }

  private watchInventory(): void {
    const total = view.inventory.reduce((sum, slot) => sum + (slot?.count ?? 0), 0);
    if (this.lastItemCount >= 0 && total > this.lastItemCount) sfx.pickup();
    this.lastItemCount = total;
  }

  private renderGround(): void {
    const seen = new Set<number>();

    for (const item of view.ground.values()) {
      seen.add(item.id);

      let container = this.groundViews.get(item.id);
      if (container === undefined) {
        const colour = ITEMS[item.key as ItemKey]?.color ?? '#ffffff';
        const tint = Phaser.Display.Color.HexStringToColor(colour).color;
        const shadow = this.add.ellipse(0, 2, 14, 5, 0x000000, 0.3);
        const body = this.add.rectangle(0, 0, 9, 9, tint).setStrokeStyle(1, 0x10161c);
        container = this.add.container(0, 0, [shadow, body]);
        this.groundViews.set(item.id, container);
      }

      const bob = Math.sin(this.time.now / 280 + item.id) * 2;
      container.setPosition(item.x, item.y - 7 + bob);
      container.setDepth(Math.round(item.y));
    }

    for (const [id, container] of this.groundViews) {
      if (seen.has(id)) continue;
      container.destroy(true);
      this.groundViews.delete(id);
    }
  }

  private renderMonsters(deltaMs: number): void {
    const share = 1 - Math.exp(-deltaMs / OTHERS_TAU_MS);
    const column = Math.floor(this.time.now / STEP_FRAME_MS) % 2 === 0 ? 1 : 2;
    const seen = new Set<number>();

    for (const monster of view.monsters.values()) {
      seen.add(monster.id);
      monster.renderX += (monster.x - monster.renderX) * share;
      monster.renderY += (monster.y - monster.renderY) * share;

      let monsterView = this.monsterViews.get(monster.id);
      if (monsterView === undefined) {
        monsterView = new MonsterView(this, `mob_${monster.key}`);
        this.monsterViews.set(monster.id, monsterView);
      }

      monsterView.setPosition(monster.renderX, monster.renderY);
      monsterView.setPose(monster.dir, monster.moving, column);
      monsterView.setHealth(monster.hp, monster.maxHp);

      const previousHp = this.lastMonsterHp.get(monster.id);
      if (previousHp !== undefined && monster.hp < previousHp) {
        const lost = previousHp - monster.hp;
        if (lost > 0) {
          this.showDamage(monster.renderX, monster.renderY - 30, lost, '#ffd479');
          this.burstAt(monster.renderX, monster.renderY - 20);
          this.triggerShake(3);
          this.monsterFlashUntil.set(monster.id, this.time.now + 100);
          sfx.hit();
        }
      }
      this.lastMonsterHp.set(monster.id, monster.hp);

      // The first snapshot that marks it dead: the killing blow landed.
      if (monster.dead && !this.deadMonsters.has(monster.id)) {
        this.deadMonsters.add(monster.id);
        this.burstAt(monster.renderX, monster.renderY - 18);
        this.triggerShake(4);
        monsterView.setDead(true);
        sfx.kill();
      }

      const flashUntil = this.monsterFlashUntil.get(monster.id);
      monsterView.setFlash(flashUntil !== undefined && this.time.now < flashUntil);
      if (flashUntil !== undefined && this.time.now >= flashUntil) {
        this.monsterFlashUntil.delete(monster.id);
      }
    }

    for (const [id, monsterView] of this.monsterViews) {
      if (seen.has(id)) continue;
      monsterView.destroy();
      this.monsterViews.delete(id);
      this.lastMonsterHp.delete(id);
      this.deadMonsters.delete(id);
      this.monsterFlashUntil.delete(id);
    }
  }

  private addTileLayer(map: MapData): Phaser.Tilemaps.TilemapLayer | null {
    const rows: number[][] = [];
    for (let y = 0; y < map.height; y += 1) {
      rows.push(map.tiles.slice(y * map.width, (y + 1) * map.width));
    }

    const tilemap = this.make.tilemap({
      data: rows,
      tileWidth: TILE_SIZE,
      tileHeight: TILE_SIZE,
    });
    const tileset = tilemap.addTilesetImage('tiles', 'tileset', TILE_SIZE, TILE_SIZE, 0, 0);
    if (tileset === null) {
      console.error('tileset texture missing');
      return null;
    }

    const layer = tilemap.createLayer(0, tileset, 0, 0);
    layer?.setDepth(-10);
    return layer;
  }

  private applyZoom(): void {
    if (this.appliedZoom === view.zoom) return;
    this.appliedZoom = view.zoom;
    this.cameras.main.setZoom(view.zoom);
  }

  private renderPlayers(deltaMs: number): void {
    const tables = this.tables;
    if (tables === null) return;

    const column = Math.floor(this.time.now / STEP_FRAME_MS) % 2 === 0 ? 1 : 2;
    const seen = new Set<number>();
    // Frame-rate independent: the same slide at 30, 60 or 144 frames per second.
    const share = 1 - Math.exp(-deltaMs / OTHERS_TAU_MS);

    for (const player of view.others.values()) {
      seen.add(player.id);
      player.renderX += (player.x - player.renderX) * share;
      player.renderY += (player.y - player.renderY) * share;

      const playerView = this.viewFor(player.id, tables);
      playerView.setPosition(player.renderX, player.renderY);
      playerView.setLook(tables, {
        body: player.body,
        hair: player.hair,
        weapon: isItemKey(player.weapon) ? player.weapon : null,
        armor: isItemKey(player.armor) ? player.armor : null,
      });
      playerView.setPose(player.dir, this.poseColumn(player.dir, player));
      playerView.setHealth(player.hp, player.maxHp, false);
      playerView.setName(player.name);

      const weapon = isItemKey(player.weapon) ? player.weapon : null;
      const duration = swingMs(swingFor(weapon));
      if (player.attackUntil > this.time.now) {
        const count = this.swingCounts.get(player.id) ?? 0;
        const sweep: 1 | -1 = count % 2 === 0 ? -1 : 1;
        playerView.setLean(
          swingLean(swingProgress(player.attackUntil - duration, duration, this.time.now), sweep),
        );
      } else {
        playerView.setLean(0);
      }

      // Their whirlwind, shown once per cast.
      if (player.whirlwindUntil > this.time.now) {
        if (!this.whirlwindShown.has(player.id)) {
          this.whirlwindShown.add(player.id);
          const reach = swingFor(weapon).range + 10;
          this.whirlwinds.push(
            new WhirlwindEffect(this, () => ({ x: player.renderX, y: player.renderY }), reach),
          );
        }
      } else {
        this.whirlwindShown.delete(player.id);
      }
    }

    const selfId = view.selfId;
    if (selfId !== null) {
      seen.add(selfId);
      const self = view.self;
      const drawn = renderedSelfPosition();
      const selfView = this.viewFor(selfId, tables);
      selfView.setPosition(drawn.x, drawn.y);
      selfView.setLook(tables, {
        body: view.self.body,
        hair: view.self.hair,
        weapon: view.equipment.weapon,
        armor: view.equipment.armor,
      });
      selfView.setPose(self.dir, this.selfColumn(column));
      selfView.setHealth(self.hp, self.maxHp, true);
      selfView.setName(self.name);

      const shown = attackPose();
      if (shown !== null) {
        selfView.setLean(swingLean(swingProgress(shown.startedAt, shown.durationMs, this.time.now), shown.sweep));
      } else {
        selfView.setLean(0);
      }

      // A hit is shown as a short red flash on the figure.
      if (self.hp < this.lastSelfHp) this.flashUntil = this.time.now + 140;
      this.lastSelfHp = self.hp;
      selfView.setTint(this.time.now < this.flashUntil ? 0xff8080 : null);

      if (!this.following) {
        // No pixel rounding: the camera follows the already interpolated
        // position exactly, so there is nothing left to snap.
        this.cameras.main.startFollow(selfView.container, false, 1, 1);
        this.following = true;
      }
    }

    for (const [id, playerView] of this.views) {
      if (seen.has(id)) continue;
      playerView.destroy();
      this.views.delete(id);
    }
  }

  /** Walk frames, or the three swing frames while a blow is running. */
  private selfColumn(walkColumn: number): number {
    const shown = attackPose();
    if (shown === null) return view.self.moving ? walkColumn : 0;

    const progress = (this.time.now - shown.startedAt) / shown.durationMs;
    if (progress < 0 || progress >= 1) return view.self.moving ? walkColumn : 0;
    return swingColumn(progress);
  }

  /** The same for other players; their swing length comes from their weapon. */
  private poseColumn(dir: Direction, player: RemotePlayer): number {
    const now = this.time.now;
    if (player.attackUntil > now) {
      const weapon = isItemKey(player.weapon) ? player.weapon : null;
      const duration = swingMs(swingFor(weapon));
      const progress = 1 - (player.attackUntil - now) / duration;
      return swingColumn(progress);
    }
    return player.moving ? Math.floor(now / STEP_FRAME_MS) % 2 === 0 ? 1 : 2 : 0;
  }

  private viewFor(id: number, tables: ArtTables): PlayerView {
    const existing = this.views.get(id);
    if (existing !== undefined) return existing;

    const created = new PlayerView(this, tables, this.pack ?? undefined);
    this.views.set(id, created);
    return created;
  }
}
