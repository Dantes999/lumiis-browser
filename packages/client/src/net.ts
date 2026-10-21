// WebSocket client. Its only jobs are: keep the socket alive, translate frames
// into state, and never invent game facts.

import { decode, encode, isItemKey, swingFor, swingMs } from '@lumiis/shared';
import type {
  ClientMessage,
  GroundItemSnapshot,
  MonsterSnapshot,
  PlayerSnapshot,
  ServerMessage,
  SkillKey,
} from '@lumiis/shared';
import { logEvent } from './log';
import { applyServerPosition } from './sim';
import { view } from './state';

/** When the swing of another player is over, judged by the weapon they hold. */
const swingEnd = (player: PlayerSnapshot): number => {
  const weapon = isItemKey(player.weapon) ? player.weapon : null;
  return performance.now() + swingMs(swingFor(weapon));
};

/** One kill: where it happened and who earned what. */
export type RewardMessage = {
  x: number;
  y: number;
  shares: Array<{ id: number; exp: number; yang: number }>;
};

let rewardHandler: ((reward: RewardMessage) => void) | null = null;

/** The scene listens here to throw experience orbs. */
export const setRewardHandler = (fn: ((reward: RewardMessage) => void) | null): void => {
  rewardHandler = fn;
};

/** Where the session token is kept between reloads. */
const TOKEN_KEY = 'lumiis.token';
/** The last character played, so a reload walks straight back in. */
const CHARACTER_KEY = 'lumiis.character';

const PING_INTERVAL_MS = 2000;
const MAX_RECONNECT_DELAY_MS = 10000;
/** No message for this long while in the world means the connection is dead. */
const STALL_MS = 7000;
/** Close code the server uses when the same character signs in elsewhere. */
const SIGNED_IN_ELSEWHERE = 4000;

type Credentials = { name: string; password: string; mode: 'login' | 'register' };

export class Connection {
  private socket: WebSocket | null = null;
  private credentials: Credentials | null = null;
  private pingTimer: number | null = null;
  /** Worker that keeps the connection alive while the tab is in the background. */
  private keepalive: Worker | null = null;
  private keepaliveUrl: string | null = null;
  private reconnectTimer: number | null = null;
  private reconnectDelayMs = 1000;
  private closedByUser = false;
  private onWelcome: (() => void) | null = null;
  /** When the last frame arrived; a stall is noticed by comparing to now. */
  private lastMessageAt = 0;
  /** The character played before a drop, so a reconnect can walk straight in. */
  private lastCharacterId: number | null = null;
  /** When the socket opened, to report how long a connection lasted. */
  private connectedAt = 0;
  /** Throttles the high-ping warning so a bad line does not flood the log. */
  private lastHighPingLog = 0;
  /** Signed session token, so a reload does not ask for the password again. */
  private token: string | null = null;

  private get url(): string {
    const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${scheme}//${location.host}/ws`;
  }

  connect(): void {
    this.closedByUser = false;
    view.status = 'connecting';
    view.notice = null;

    try {
      this.token = window.localStorage.getItem(TOKEN_KEY);
      const storedCharacter = window.localStorage.getItem(CHARACTER_KEY);
      this.lastCharacterId = storedCharacter === null ? null : Number(storedCharacter);
    } catch {
      this.token = null;
      this.lastCharacterId = null;
    }

    logEvent('info', `connecting to ${this.url}`);

    const socket = new WebSocket(this.url);
    this.socket = socket;
    this.lastMessageAt = performance.now();

    socket.addEventListener('open', () => {
      this.reconnectDelayMs = 1000;
      this.lastMessageAt = performance.now();
      this.connectedAt = performance.now();
      if (this.token !== null) {
        logEvent('info', 'connected, resuming session');
        this.send({ t: 'resume', token: this.token });
      } else {
        logEvent('info', 'connected, logging in');
        this.sendLogin();
      }
      this.startPinging();
    });

    socket.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') return;
      this.lastMessageAt = performance.now();
      this.handleMessage(decode(event.data));
    });

    socket.addEventListener('close', (event) => {
      this.stopPinging();
      view.status = 'offline';
      view.selfId = null;
      view.others.clear();
      view.monsters.clear();
      view.ground.clear();
      this.socket = null;

      const lasted = this.connectedAt === 0 ? '?' : ((performance.now() - this.connectedAt) / 1000).toFixed(1);
      this.connectedAt = 0;

      if (event.code === SIGNED_IN_ELSEWHERE) {
        // Another session took this character. Jumping straight back in would
        // make the two kick each other forever, so stop auto-selecting and just
        // show the character list again.
        this.lastCharacterId = null;
        view.notice = 'Signed in elsewhere';
        view.noticeUntil = performance.now() + 5000;
        logEvent('warn', `character in use elsewhere after ${lasted}s; pick it again to take it back`);
      } else {
        logEvent(
          'warn',
          `connection closed after ${lasted}s (code ${event.code}${event.reason ? `: ${event.reason}` : ''})`,
        );
      }

      if (!this.closedByUser) this.scheduleReconnect();
    });

    socket.addEventListener('error', () => {
      logEvent('error', 'socket error');
      socket.close();
    });
  }

  disconnect(): void {
    this.closedByUser = true;
    this.stopPinging();
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.socket?.close();
  }

  selectCharacter(id: number): void {
    this.lastCharacterId = id;
    try {
      window.localStorage.setItem(CHARACTER_KEY, String(id));
    } catch {
      // Private mode: the choice lasts for this tab only.
    }
    this.send({ t: 'select', id });
  }

  createCharacter(name: string): void {
    this.send({ t: 'createCharacter', name });
  }

  /** Sends a login attempt, connecting first if needed. */
  submit(name: string, password: string, mode: 'login' | 'register'): void {
    this.credentials = { name, password, mode };
    view.authError = null;

    if (this.socket === null) this.connect();
    else if (this.socket.readyState === WebSocket.OPEN) this.sendLogin();
  }

  private sendLogin(): void {
    if (this.credentials === null) return;
    this.send({ t: 'login', ...this.credentials });
  }

  setInput(dx: number, dy: number): void {
    this.send({ t: 'input', dx, dy });
  }

  /** A swing; with a monster id it turns towards it, without it goes ahead. */
  attack(message: { target?: number; dir?: number }): void {
    this.send({ t: 'attack', ...message });
  }

  /** Fires a skill (a buff or a whirlwind). */
  useSkill(key: SkillKey): void {
    this.send({ t: 'skill', key });
  }

  /** Mirrors one client log line to the server terminal. */
  sendClientLog(level: 'info' | 'warn' | 'error', text: string): void {
    // Keep it well under the protocol limit: an over-long line would make the
    // server reject the message and close the connection.
    this.send({ t: 'log', level, text: text.slice(0, 400) });
  }

  pickup(target: number): void {
    this.send({ t: 'pickup', target });
  }

  equip(slot: number): void {
    this.send({ t: 'equip', slot });
  }

  unequip(piece: 'weapon' | 'armor'): void {
    this.send({ t: 'unequip', piece });
  }

  setPickupSettings(autoPickup: boolean, autoPickupTypes: string[]): void {
    this.send({ t: 'settings', autoPickup, autoPickupTypes });
  }

  /** Called after every successful handshake, so settings can be re-sent. */
  setWelcomeHandler(handler: () => void): void {
    this.onWelcome = handler;
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return;
    const delay = this.reconnectDelayMs;
    this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, MAX_RECONNECT_DELAY_MS);
    logEvent('info', `reconnecting in ${Math.round(delay / 1000)}s`);
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  /**
   * A dead TCP connection never fires "close": the socket stays OPEN while
   * nothing arrives. Without this the player keeps walking on a frozen world.
   * Drop the socket ourselves so the normal close path reconnects.
   */
  private checkStall(): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    if (view.selfId === null) return;
    if (performance.now() - this.lastMessageAt < STALL_MS) return;

    const silent = ((performance.now() - this.lastMessageAt) / 1000).toFixed(1);
    logEvent(
      'warn',
      `no traffic for ${silent}s (last ping ${view.pingMs ?? '?'}ms), dropping the connection`,
    );
    const socket = this.socket;
    this.socket = null;
    this.stopPinging();
    view.status = 'offline';
    view.selfId = null;
    view.others.clear();
    view.monsters.clear();
    view.ground.clear();
    try {
      socket?.close();
    } catch {
      // The socket is already gone; nothing to do.
    }
    if (!this.closedByUser) this.scheduleReconnect();
  }

  private startPinging(): void {
    this.stopPinging();

    const tick = (): void => {
      this.checkStall();
      this.send({ t: 'ping', at: performance.now() });
    };

    // A background tab throttles its timers to about once a minute, which lets
    // the connection die of silence. A worker's timer is not throttled, so it
    // ticks and wakes the main thread to send the ping.
    try {
      const source = `setInterval(function () { postMessage(0); }, ${PING_INTERVAL_MS});`;
      const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      const worker = new Worker(url);
      worker.onmessage = tick;
      this.keepalive = worker;
      this.keepaliveUrl = url;
    } catch {
      // No workers (old browser or blocked): fall back to a plain timer.
      this.pingTimer = window.setInterval(tick, PING_INTERVAL_MS);
    }
  }

  private stopPinging(): void {
    if (this.keepalive !== null) {
      this.keepalive.terminate();
      this.keepalive = null;
    }
    if (this.keepaliveUrl !== null) {
      URL.revokeObjectURL(this.keepaliveUrl);
      this.keepaliveUrl = null;
    }
    if (this.pingTimer !== null) window.clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private send(message: ClientMessage): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(encode(message));
  }

  private handleMessage(raw: unknown): void {
    if (typeof raw !== 'object' || raw === null) return;
    const message = raw as ServerMessage;

    switch (message.t) {
      case 'welcome':
        logEvent('info', `in the world on map "${message.map}"`);
        view.status = 'online';
        view.selfId = message.id;
        view.tick = message.tick;
        view.mapId = message.map;
        // A reconnect must log in, not try to register the same name again.
        if (this.credentials !== null) this.credentials.mode = 'login';
        this.onWelcome?.();
        break;
      case 'snapshot':
        view.tick = message.tick;
        view.mapId = message.map;
        this.applySnapshot(message.players, message.monsters, message.ground);
        break;
      case 'inventory':
        view.inventory = message.slots;
        view.equipment = message.equipment;
        break;
      case 'pong': {
        const ping = Math.max(0, Math.round(performance.now() - message.at));
        view.pingMs = ping;
        if (ping > 2000 && performance.now() - this.lastHighPingLog > 10000) {
          this.lastHighPingLog = performance.now();
          logEvent('warn', `high ping: ${ping}ms`);
        }
        break;
      }
      case 'notice':
        view.notice = message.text;
        view.noticeUntil = performance.now() + 3000;
        break;
      case 'reward':
        rewardHandler?.(message);
        break;
      case 'authError':
        logEvent('warn', `auth error: ${message.reason}`);
        // The stored session is no good: forget it and show the login form.
        this.token = null;
        try {
          window.localStorage.removeItem(TOKEN_KEY);
        } catch {
          // Private mode: there was nothing to remove.
        }
        view.authError = message.reason;
        break;
      case 'characters': {
        view.characters = message.list;
        view.characterMax = message.max;
        if (message.token !== undefined) {
          this.token = message.token;
          try {
            window.localStorage.setItem(TOKEN_KEY, message.token);
          } catch {
            // Private mode: the session lasts for this tab only.
          }
        }
        // After a drop, walk straight back into the same character instead of
        // making the player pick again.
        const remembered = this.lastCharacterId;
        if (remembered !== null && view.selfId === null) {
          const known = message.list.some((entry) => entry.id === remembered);
          if (known) this.send({ t: 'select', id: remembered });
        }
        break;
      }
    }
  }

  /**
   * The server is always right. We keep our predicted position for rendering and
   * fade the difference out, so a correction looks like a slide, not a jump.
   */
  private applySnapshot(
    players: PlayerSnapshot[],
    monsters: MonsterSnapshot[],
    ground: GroundItemSnapshot[],
  ): void {
    const seen = new Set<number>();

    for (const player of players) {
      if (player.id === view.selfId) {
        view.self.name = player.name;
        applyServerPosition(player.x, player.y);
        view.self.hp = player.hp;
        view.self.maxHp = player.maxHp;
        view.self.level = player.level;
        view.self.exp = player.exp;
        view.self.yang = player.yang;
        view.self.buffs = player.buffs ?? {};
        continue;
      }

      seen.add(player.id);
      const existing = view.others.get(player.id);
      if (existing === undefined) {
        view.others.set(player.id, {
          id: player.id,
          name: player.name,
          x: player.x,
          y: player.y,
          dir: player.dir as typeof view.self.dir,
          moving: player.moving,
          hp: player.hp,
          maxHp: player.maxHp,
          weapon: player.weapon,
          armor: player.armor,
          attackUntil: player.attacking === true ? swingEnd(player) : 0,
          whirlwindUntil: player.whirlwind === true ? performance.now() + 600 : 0,
          buffs: player.buffs ?? {},
          renderX: player.x,
          renderY: player.y,
        });
      } else {
        existing.name = player.name;
        existing.x = player.x;
        existing.y = player.y;
        existing.dir = player.dir as typeof view.self.dir;
        existing.moving = player.moving;
        existing.hp = player.hp;
        existing.maxHp = player.maxHp;
        existing.weapon = player.weapon;
        existing.armor = player.armor;
        if (player.attacking === true) existing.attackUntil = swingEnd(player);
        if (player.whirlwind === true) existing.whirlwindUntil = performance.now() + 600;
        existing.buffs = player.buffs ?? {};
      }
    }

    for (const id of [...view.others.keys()]) {
      if (!seen.has(id)) view.others.delete(id);
    }

    const seenMonsters = new Set<number>();
    for (const monster of monsters) {
      seenMonsters.add(monster.id);
      const existing = view.monsters.get(monster.id);

      if (existing === undefined) {
        view.monsters.set(monster.id, {
          id: monster.id,
          key: monster.key,
          x: monster.x,
          y: monster.y,
          dir: monster.dir as typeof view.self.dir,
          hp: monster.hp,
          maxHp: monster.maxHp,
          moving: monster.moving,
          dead: monster.dead === true,
          renderX: monster.x,
          renderY: monster.y,
        });
      } else {
        existing.x = monster.x;
        existing.y = monster.y;
        existing.dir = monster.dir as typeof view.self.dir;
        existing.hp = monster.hp;
        existing.maxHp = monster.maxHp;
        existing.moving = monster.moving;
        existing.dead = monster.dead === true;
      }
    }

    for (const id of [...view.monsters.keys()]) {
      if (!seenMonsters.has(id)) view.monsters.delete(id);
    }

    const seenGround = new Set<number>();
    for (const item of ground) {
      seenGround.add(item.id);
      const existing = view.ground.get(item.id);
      if (existing === undefined) {
        view.ground.set(item.id, { id: item.id, key: item.key, x: item.x, y: item.y, count: item.count });
      } else {
        existing.x = item.x;
        existing.y = item.y;
        existing.count = item.count;
      }
    }

    for (const id of [...view.ground.keys()]) {
      if (!seenGround.has(id)) view.ground.delete(id);
    }
  }
}
