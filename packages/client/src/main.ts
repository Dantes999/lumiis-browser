// Boot: one Phaser game, one connection, one HUD refresh loop.
// No game rules live here — this file only wires parts together.

import Phaser from 'phaser';
import { findPath } from '@lumiis/shared';
import { WorldScene } from './scene/world-scene';
import { Connection } from './net';
import { initInput } from './input';
import { attackAt, attackNearestInRange, setAttackSender } from './combat';
import { initController, walkAlong } from './controller';
import { view } from './state';
import { getWorldMap } from './world-map';
import { createHud } from './ui/hud';
import { createBag } from './ui/bag';

const HUD_REFRESH_MS = 100;
const NAME_PATTERN = /[^A-Za-z0-9_]/g;

const playerName = (): string => {
  const fromUrl = new URLSearchParams(location.search).get('name');
  const base = fromUrl ?? `Player${Math.floor(1000 + Math.random() * 9000)}`;
  return base.replace(NAME_PATTERN, '').slice(0, 16) || 'Player';
};

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#0b0f13',
  // Crisp pixel edges, but no snapping of the camera to whole pixels: rounding
  // the scroll while the figure moves smoothly produces visible micro-stutter.
  render: { pixelArt: true, antialias: false, roundPixels: false },
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: window.innerWidth,
    height: window.innerHeight,
  },
  scene: [WorldScene],
});

const connection = new Connection(playerName());
setAttackSender((target) => connection.attack(target));
initController((dx, dy) => connection.setInput(dx, dy));

initInput({
  onAttack: () => {
    attackNearestInRange();
  },
  onTap: (screenX, screenY) => {
    const scene = game.scene.getScene('world');
    if (scene === null || !scene.sys.isActive()) return;

    const point = scene.cameras.main.getWorldPoint(screenX, screenY);

    // A tap on a monster within reach is a hit; anything else is a walk order.
    if (attackAt(point.x, point.y)) return;

    const map = getWorldMap();
    if (map === null) return;

    const path = findPath(map, { x: view.self.x, y: view.self.y }, point);
    if (path !== null) walkAlong(path);
  },
});

connection.connect();

const hud = createHud();
const bag = createBag();
window.setInterval(() => {
  hud.render(view);
  bag.render(view.inventory);
}, HUD_REFRESH_MS);

// Handy for poking at the state from the console during development.
Object.assign(window, { lumiis: { view, connection, game } });
