// The world view: tilemap, players, camera.
// Positions come from the simulation; the server is the final word.

import Phaser from 'phaser';
import {
  ITEMS,
  isItemKey,
  MONSTER_KEYS,
  MONSTER_TYPES,
  TILE_SIZE,
  mapPixelHeight,
  mapPixelWidth,
  validateMap,
  type ItemKey,
  type MapData,
} from '@lumiis/shared';
import { sfx } from '../audio';
import { PlayerView, readTables, spriteSheets, type ArtTables } from '../art';
import { attackPoseUntil } from '../combat';
import { MOB_CELL_H, MOB_CELL_W, MonsterView } from '../mobart';
import { renderedSelfPosition, stepLocal } from '../sim';
import { view } from '../state';
import { buildTilesetTexture } from '../tiles';
import { setWorldMap } from '../world-map';

/** Milliseconds per walking frame. */
const STEP_FRAME_MS = 180;
/** Time constant for other players catching up to their reported position. */
const OTHERS_TAU_MS = 60;

export class WorldScene extends Phaser.Scene {
  private tables: ArtTables | null = null;
  private readonly views = new Map<number, PlayerView>();
  private readonly monsterViews = new Map<number, MonsterView>();
  private readonly groundViews = new Map<number, Phaser.GameObjects.Container>();
  private following = false;
  private appliedZoom = 0;
  private mapId: string | null = null;
  private layer: Phaser.Tilemaps.TilemapLayer | null = null;
  private lastSelfHp = -1;
  private flashUntil = 0;
  private lastLevel = -1;
  private lastItemCount = -1;
  private readonly lastMonsterHp = new Map<number, number>();

  constructor() {
    super('world');
  }

  preload(): void {
    this.load.json('rows_armor', '/assets/ruestungen/ruestungen.json');
    this.load.json('rows_head', '/assets/modelle/spieler/spieler.json');
    this.load.json('rows_hair', '/assets/haare/haare.json');
    this.load.json('rows_weapon', '/assets/waffen/waffen.json');

    // Every player sheet uses the same 48x48 grid; only the row tables differ.
    const grid = { frameWidth: 48, frameHeight: 48 };
    for (const sheet of spriteSheets()) this.load.spritesheet(sheet.key, sheet.path, grid);

    // One sheet per monster type, 40x32 cells, four views of five frames.
    for (const key of MONSTER_KEYS) {
      this.load.spritesheet(
        `mob_${key}`,
        `/assets/modelle/monster/${MONSTER_TYPES[key].look}.png`,
        { frameWidth: MOB_CELL_W, frameHeight: MOB_CELL_H },
      );
    }
  }

  create(): void {
    this.tables = readTables(this);
    this.cameras.main.setBackgroundColor('#0b0f13');
    buildTilesetTexture(this);
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
    this.syncMap();
    this.applyZoom();
    stepLocal(delta);
    this.renderGround();
    this.renderMonsters(delta);
    this.renderPlayers(delta);
    this.watchInventory();
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
          sfx.hit();
        }
        if (monster.hp <= 0) sfx.kill();
      }
      this.lastMonsterHp.set(monster.id, monster.hp);
    }

    for (const [id, monsterView] of this.monsterViews) {
      if (seen.has(id)) continue;
      monsterView.destroy();
      this.monsterViews.delete(id);
      this.lastMonsterHp.delete(id);
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
        weapon: isItemKey(player.weapon) ? player.weapon : null,
        armor: isItemKey(player.armor) ? player.armor : null,
      });
      playerView.setPose(player.dir, player.moving ? column : 0);
    }

    const selfId = view.selfId;
    if (selfId !== null) {
      seen.add(selfId);
      const self = view.self;
      const drawn = renderedSelfPosition();
      const selfView = this.viewFor(selfId, tables);
      selfView.setPosition(drawn.x, drawn.y);
      selfView.setLook(tables, view.equipment);
      selfView.setPose(self.dir, self.moving ? column : 0);

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

  private viewFor(id: number, tables: ArtTables): PlayerView {
    const existing = this.views.get(id);
    if (existing !== undefined) return existing;

    const created = new PlayerView(this, tables);
    this.views.set(id, created);
    return created;
  }
}
