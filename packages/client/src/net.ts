// WebSocket client. Its only jobs are: keep the socket alive, translate frames
// into state, and never invent game facts.

import { PROTOCOL_VERSION, decode, encode } from '@lumiis/shared';
import type {
  ClientMessage,
  MonsterSnapshot,
  PlayerSnapshot,
  ServerMessage,
} from '@lumiis/shared';
import { cancelWalk } from './controller';
import { applyServerPosition } from './sim';
import { view } from './state';

const PING_INTERVAL_MS = 2000;
const MAX_RECONNECT_DELAY_MS = 10000;

export class Connection {
  private socket: WebSocket | null = null;
  private pingTimer: number | null = null;
  private reconnectTimer: number | null = null;
  private reconnectDelayMs = 1000;
  private closedByUser = false;

  constructor(private readonly name: string) {}

  private get url(): string {
    const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${scheme}//${location.host}/ws`;
  }

  connect(): void {
    this.closedByUser = false;
    view.status = 'connecting';
    view.notice = null;

    const socket = new WebSocket(this.url);
    this.socket = socket;

    socket.addEventListener('open', () => {
      this.reconnectDelayMs = 1000;
      this.send({ t: 'hello', v: PROTOCOL_VERSION, name: this.name });
      this.startPinging();
    });

    socket.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') return;
      this.handleMessage(decode(event.data));
    });

    socket.addEventListener('close', () => {
      this.stopPinging();
      view.status = 'offline';
      view.others.clear();
      view.monsters.clear();
      this.socket = null;
      if (!this.closedByUser) this.scheduleReconnect();
    });

    socket.addEventListener('error', () => {
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

  setInput(dx: number, dy: number): void {
    this.send({ t: 'input', dx, dy });
  }

  attack(target: number): void {
    this.send({ t: 'attack', target });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return;
    const delay = this.reconnectDelayMs;
    this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, MAX_RECONNECT_DELAY_MS);
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private startPinging(): void {
    this.stopPinging();
    this.pingTimer = window.setInterval(() => {
      this.send({ t: 'ping', at: performance.now() });
    }, PING_INTERVAL_MS);
  }

  private stopPinging(): void {
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
        view.status = 'online';
        view.selfId = message.id;
        view.tick = message.tick;
        break;
      case 'snapshot':
        view.tick = message.tick;
        this.applySnapshot(message.players, message.monsters);
        break;
      case 'pong':
        view.pingMs = Math.max(0, Math.round(performance.now() - message.at));
        break;
      case 'notice':
        view.notice = message.text;
        view.noticeUntil = performance.now() + 3000;
        break;
    }
  }

  /**
   * The server is always right. We keep our predicted position for rendering and
   * fade the difference out, so a correction looks like a slide, not a jump.
   */
  private applySnapshot(players: PlayerSnapshot[], monsters: MonsterSnapshot[]): void {
    const seen = new Set<number>();

    for (const player of players) {
      if (player.id === view.selfId) {
        applyServerPosition(player.x, player.y);
        if (player.hp <= 0 && view.self.hp > 0) cancelWalk();
        view.self.hp = player.hp;
        view.self.maxHp = player.maxHp;
        view.self.level = player.level;
        view.self.exp = player.exp;
        view.self.yang = player.yang;
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
          renderX: player.x,
          renderY: player.y,
        });
      } else {
        existing.name = player.name;
        existing.x = player.x;
        existing.y = player.y;
        existing.dir = player.dir as typeof view.self.dir;
        existing.moving = player.moving;
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
      }
    }

    for (const id of [...view.monsters.keys()]) {
      if (!seenMonsters.has(id)) view.monsters.delete(id);
    }
  }
}
