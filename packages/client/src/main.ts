// Boot: one Phaser game, one connection, one HUD refresh loop.
// No game rules live here — this file only wires parts together.

import Phaser from 'phaser';
import { SKILL_KEYS } from '@lumiis/shared';
import { WorldScene } from './scene/world-scene';
import { Connection, setChatHandler } from './net';
import { audioState, sfx } from './audio';
import { initInput } from './input';
import { initMobile } from './mobile';
import { attackAt, isAttackHeld, setAttackHeld, setAttackSender, swingForward } from './combat';
import { cast, setSkillSender } from './skill';
import { setAimEnabled, setStickAim } from './aim';
import { initAudio, resumeAudio, unlockAudioOnFirstGesture } from './audio';
import { initController } from './controller';
import { itemNear, orderPickup, pickupNearestInRange, setPickupSender, tickPickup } from './loot';
import { view } from './state';
import { createHud } from './ui/hud';
import { createBag } from './ui/bag';
import { createCharacterScreen } from './ui/characters';
import { createChannelUi } from './ui/channel';
import { createLogin } from './ui/login';
import { createSettings } from './ui/settings';
import { createLogPanel } from './ui/logpanel';
import { createChatPanel } from './ui/chat';
import { logEvent, setLogForwarder } from './log';

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
setSkillSender((key) => connection.useSkill(key));

/** Triggers the skill in a hotbar slot (0 = "1", 1 = "2"). */
const castSlot = (slot: number): void => {
  const key = SKILL_KEYS[slot];
  if (key !== undefined) cast(key);
};
setPickupSender((itemId) => connection.pickup(itemId));
initController((dx, dy) => connection.setInput(dx, dy));

const settings = createSettings((value) => {
  connection.setPickupSettings(value.autoPickup, value.types);
  setAimEnabled(value.aimAtMouse);
});

// Apply the stored aim setting right away, before the first click.
setAimEnabled(settings.current().aimAtMouse);

// The browser only allows sound after a gesture; the login click is one, and
// this listener is the safety net for every other first interaction.
unlockAudioOnFirstGesture();
initMobile();

const login = createLogin((name, password, mode) => {
  initAudio();
  resumeAudio();
  connection.submit(name, password, mode);
});

const characters = createCharacterScreen(
  (id) => connection.requestChannels(id),
  (id, channel) => connection.selectCharacter(id, channel),
  (name, body, hair) => connection.createCharacter(name, hair, body),
);
const channelUi = createChannelUi(
  () => connection.requestChannels(),
  (channel) => connection.switchChannel(channel),
);

connection.setWelcomeHandler(() => {
  login.hide();
  characters.hide();
  view.characters = null;

  const value = settings.current();
  connection.setPickupSettings(value.autoPickup, value.types);
});

// A stored session token means a reload walks straight back in: connect now and
// let the server answer with the character list.
try {
  if (window.localStorage.getItem('lumiis.token') !== null) connection.connect();
} catch {
  // Private mode: there is no stored session.
}

initInput({
  onAttack: () => {
    swingForward();
  },
  onAttackHold: (held) => {
    setAttackHeld(held);
  },
  onSkill: (slot) => {
    castSlot(slot);
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
  // Left mouse: holding the button keeps swinging, just like holding Space.
  onWorldDown: (screenX, screenY) => {
    const scene = game.scene.getScene('world');
    if (scene === null || !scene.sys.isActive()) return;

    const point = scene.cameras.main.getWorldPoint(screenX, screenY);
    const item = itemNear(point.x, point.y);
    if (item !== null) {
      orderPickup(item.id);
      return;
    }

    setAttackHeld(true);
    attackAt(point.x, point.y);
  },
  onWorldUp: () => {
    setAttackHeld(false);
  },
  onAttackAim: (dir) => {
    setStickAim(dir);
  },
});

createLogPanel();
const chat = createChatPanel((text) => connection.sendChat(text));
setChatHandler(() => chat.render());

// Every client log line is mirrored to the server, which prints it in the
// terminal next to its own "[ws]" lines.
setLogForwarder((entry) => connection.sendClientLog(entry.level, entry.text));

// Anything that escapes a handler or a promise is written to the log window, so
// a frozen client on another machine still leaves evidence.
window.addEventListener('error', (event) => {
  logEvent('error', `script error: ${event.message}`);
});
window.addEventListener('unhandledrejection', (event) => {
  logEvent('error', `unhandled rejection: ${String(event.reason)}`);
});
logEvent('info', `client started on ${location.host}`);

const hud = createHud((slot) => castSlot(slot));
const bag = createBag(
  (slot) => connection.equip(slot),
  (piece) => connection.unequip(piece),
);
window.setInterval(() => {
  hud.render(view);
  bag.render(view.inventory, view.equipment);
  channelUi.render(view);
  tickPickup();

  if (view.characters !== null) {
    login.hide();
    characters.show(view.characters, view.characterMax);
  }
  // The server answers the login picker with the channel list.
  const options = view.channelOptions;
  if (options !== null && options.id !== null && view.status !== 'online') {
    characters.showChannels(options.id, options.list);
  } else {
    characters.hideChannels();
  }
  if (view.authError !== null) {
    login.showError(view.authError);
    characters.showError(view.authError);
  }
}, HUD_REFRESH_MS);

// Handy for poking at the state from the console during development.
Object.assign(window, {
  lumiis: {
    view,
    connection,
    game,
    audio: { state: audioState, sfx },
    debug: { isAttackHeld },
  },
});
