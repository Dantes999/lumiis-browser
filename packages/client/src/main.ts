// Boot: one Phaser game, one connection, one HUD refresh loop.
// No game rules live here — this file only wires parts together.

import Phaser from 'phaser';
import { findPath } from '@lumiis/shared';
import { WorldScene } from './scene/world-scene';
import { Connection } from './net';
import { initInput } from './input';
import { attackAt, attackNearestInRange, setAttackSender } from './combat';
import { initController, walkAlong } from './controller';
import { itemNear, orderPickup, pickupNearestInRange, setPickupSender, tickPickup } from './loot';
import { view } from './state';
import { getWorldMap } from './world-map';
import { createHud } from './ui/hud';
import { createBag } from './ui/bag';
import { createLogin } from './ui/login';
import { createSettings } from './ui/settings';

const HUD_REFRESH_MS = 100;

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

const connection = new Connection();
setAttackSender((target) => connection.attack(target));
setPickupSender((itemId) => connection.pickup(itemId));
initController((dx, dy) => connection.setInput(dx, dy));

const settings = createSettings((value) => {
  connection.setPickupSettings(value.autoPickup, value.types);
});

const login = createLogin((name, password, mode) => {
  connection.submit(name, password, mode);
});

connection.setWelcomeHandler(() => {
  login.hide();
  const value = settings.current();
  connection.setPickupSettings(value.autoPickup, value.types);
});

initInput({
  onAttack: () => {
    attackNearestInRange();
  },
  onPickup: () => {
    pickupNearestInRange();
  },
  onTap: (screenX, screenY) => {
    const scene = game.scene.getScene('world');
    if (scene === null || !scene.sys.isActive()) return;

    const point = scene.cameras.main.getWorldPoint(screenX, screenY);

    // A tap on a monster within reach is a hit.
    if (attackAt(point.x, point.y)) return;

    const map = getWorldMap();
    if (map === null) return;

    // A tap on an item is an order: walk there and take it.
    const item = itemNear(point.x, point.y);
    if (item !== null) {
      orderPickup(item.id);
      const path = findPath(map, { x: view.self.x, y: view.self.y }, { x: item.x, y: item.y });
      if (path !== null) walkAlong(path);
      return;
    }

    const path = findPath(map, { x: view.self.x, y: view.self.y }, point);
    if (path !== null) walkAlong(path);
  },
});

const hud = createHud();
const bag = createBag();
window.setInterval(() => {
  hud.render(view);
  bag.render(view.inventory);
  tickPickup();
  if (view.authError !== null) login.showError(view.authError);
}, HUD_REFRESH_MS);

// Handy for poking at the state from the console during development.
Object.assign(window, { lumiis: { view, connection, game } });
