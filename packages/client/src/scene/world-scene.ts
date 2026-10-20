// The world view: tilemap, players, camera.
// Positions come from the simulation; the server is the final word.

import Phaser from 'phaser';
import {
  MONSTER_KEYS,
  MONSTER_TYPES,
  TILE_SIZE,
  mapPixelHeight,
  mapPixelWidth,
  validateMap,
  type MapData,
} from '@lumiis/shared';
import { PlayerView, readRows, type SpriteRows } from '../art';
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
  private rows: SpriteRows | null = null;
  private readonly views = new Map<number, PlayerView>();
  private readonly monsterViews = new Map<number, MonsterView>();
  private following = false;
  private appliedZoom = 0;
  private lastSelfHp = -1;
  private flashUntil = 0;

  constructor() {
    super('world');
  }

  preload(): void {
    this.load.json('map', '/maps/testmap.json');
    this.load.json('rows_armor', '/assets/ruestungen/ruestungen.json');
    this.load.json('rows_head', '/assets/modelle/spieler/spieler.json');
    this.load.json('rows_hair', '/assets/haare/haare.json');

    // Every sheet uses the same 48x48 grid; only the row tables differ.
    const grid = { frameWidth: 48, frameHeight: 48 };
    this.load.spritesheet('body', '/assets/ruestungen/krieger_m/00_ohne_ruestung.png', grid);
    this.load.spritesheet('head', '/assets/modelle/spieler/krieger_m.png', grid);
    this.load.spritesheet('hair', '/assets/haare/krieger_m_1.png', grid);

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
    this.rows = readRows(this);
    this.cameras.main.setBackgroundColor('#0b0f13');
    this.buildWorld();
  }

  override update(_time: number, delta: number): void {
    this.applyZoom();
    stepLocal(delta);
    this.renderMonsters(delta);
    this.renderPlayers(delta);
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
    }

    for (const [id, monsterView] of this.monsterViews) {
      if (seen.has(id)) continue;
      monsterView.destroy();
      this.monsterViews.delete(id);
    }
  }

  private buildWorld(): void {
    const check = validateMap(this.cache.json.get('map'));
    if (!check.ok) {
      console.error('map could not be loaded:', check.errors);
      return;
    }

    const map: MapData = check.map;
    setWorldMap(map);

    buildTilesetTexture(this);
    this.addTileLayer(map);

    this.cameras.main.setBounds(0, 0, mapPixelWidth(map), mapPixelHeight(map));
    this.cameras.main.centerOn(mapPixelWidth(map) / 2, mapPixelHeight(map) / 2);
  }

  private addTileLayer(map: MapData): void {
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
      return;
    }

    tilemap.createLayer(0, tileset, 0, 0)?.setDepth(-10);
  }

  private applyZoom(): void {
    if (this.appliedZoom === view.zoom) return;
    this.appliedZoom = view.zoom;
    this.cameras.main.setZoom(view.zoom);
  }

  private renderPlayers(deltaMs: number): void {
    const rows = this.rows;
    if (rows === null) return;

    const column = Math.floor(this.time.now / STEP_FRAME_MS) % 2 === 0 ? 1 : 2;
    const seen = new Set<number>();
    // Frame-rate independent: the same slide at 30, 60 or 144 frames per second.
    const share = 1 - Math.exp(-deltaMs / OTHERS_TAU_MS);

    for (const player of view.others.values()) {
      seen.add(player.id);
      player.renderX += (player.x - player.renderX) * share;
      player.renderY += (player.y - player.renderY) * share;

      const playerView = this.viewFor(player.id, rows);
      playerView.setPosition(player.renderX, player.renderY);
      playerView.setPose(rows, player.dir, player.moving ? column : 0);
    }

    const selfId = view.selfId;
    if (selfId !== null) {
      seen.add(selfId);
      const self = view.self;
      const drawn = renderedSelfPosition();
      const selfView = this.viewFor(selfId, rows);
      selfView.setPosition(drawn.x, drawn.y);
      selfView.setPose(rows, self.dir, self.moving ? column : 0);

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

  private viewFor(id: number, rows: SpriteRows): PlayerView {
    const existing = this.views.get(id);
    if (existing !== undefined) return existing;

    const created = new PlayerView(this, rows);
    this.views.set(id, created);
    return created;
  }
}
