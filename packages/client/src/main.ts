// Boot: one Phaser game, one connection, one HUD refresh loop.
// No game rules live here — this file only wires parts together.

import Phaser from 'phaser';
import { WorldScene } from './scene/world-scene';
import { Connection } from './net';
import { audioState, sfx } from './audio';
import { initInput } from './input';
import { attackAt, setAttackSender, swingForward } from './combat';
import { initAudio, resumeAudio, unlockAudioOnFirstGesture } from './audio';
import { initController } from './controller';
import { itemNear, orderPickup, pickupNearestInRange, setPickupSender, tickPickup } from './loot';
import { view } from './state';
import { createHud } from './ui/hud';
import { createBag } from './ui/bag';
import { createCharacterScreen } from './ui/characters';
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
setAttackSender((message) => connection.attack(message));
setPickupSender((itemId) => connection.pickup(itemId));
initController((dx, dy) => connection.setInput(dx, dy));

const settings = createSettings((value) => {
  connection.setPickupSettings(value.autoPickup, value.types);
});

// The browser only allows sound after a gesture; the login click is one, and
// this listener is the safety net for every other first interaction.
unlockAudioOnFirstGesture();

const login = createLogin((name, password, mode) => {
  initAudio();
  resumeAudio();
  connection.submit(name, password, mode);
});

const characters = createCharacterScreen(
  (id) => connection.selectCharacter(id),
  (name) => connection.createCharacter(name),
);

connection.setWelcomeHandler(() => {
  login.hide();
  characters.hide();
  view.characters = null;

  const value = settings.current();
  connection.setPickupSettings(value.autoPickup, value.types);
});

initInput({
  onAttack: () => {
    swingForward();
  },
  onPickup: () => {
    pickupNearestInRange();
  },
  onTap: (screenX, screenY) => {
    const scene = game.scene.getScene('world');
    if (scene === null || !scene.sys.isActive()) return;

    const point = scene.cameras.main.getWorldPoint(screenX, screenY);

    // A tap on an item is an order to take it; anything else is a swing.
    const item = itemNear(point.x, point.y);
    if (item !== null) {
      orderPickup(item.id);
      return;
    }

    attackAt(point.x, point.y);
  },
});

const hud = createHud();
const bag = createBag(
  (slot) => connection.equip(slot),
  (piece) => connection.unequip(piece),
);
window.setInterval(() => {
  hud.render(view);
  bag.render(view.inventory, view.equipment);
  tickPickup();

  if (view.characters !== null) {
    login.hide();
    characters.show(view.characters, view.characterMax);
  }
  if (view.authError !== null) {
    login.showError(view.authError);
    characters.showError(view.authError);
  }
}, HUD_REFRESH_MS);

// Handy for poking at the state from the console during development.
Object.assign(window, {
  lumiis: { view, connection, game, audio: { state: audioState, sfx } },
});
