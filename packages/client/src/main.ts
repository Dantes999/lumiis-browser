// Boot: one Phaser game, one connection, one HUD refresh loop.
// No game rules live here — this file only wires parts together.

import Phaser from 'phaser';
import { WorldScene } from './scene/world-scene';
import { Connection } from './net';
import { view } from './state';
import { createHud } from './ui/hud';

const HUD_REFRESH_MS = 100;
const NAME_PATTERN = /[^A-Za-z0-9_]/g;

const playerName = (): string => {
  const fromUrl = new URLSearchParams(location.search).get('name');
  const base = fromUrl ?? `Player${Math.floor(1000 + Math.random() * 9000)}`;
  return base.replace(NAME_PATTERN, '').slice(0, 16) || 'Player';
};

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#101418',
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: window.innerWidth,
    height: window.innerHeight,
  },
  pixelArt: true,
  scene: [WorldScene],
});

const hud = createHud();
window.setInterval(() => hud.render(view), HUD_REFRESH_MS);

const connection = new Connection(playerName());
connection.connect();

// Handy for poking at the state from the console during development.
Object.assign(window, { lumiis: { view, connection } });
