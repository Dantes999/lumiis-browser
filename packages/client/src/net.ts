// WebSocket client. Its only jobs are: keep the socket alive, translate frames
// into state, and never invent game facts.

import { PROTOCOL_VERSION, decode, encode } from '@lumiis/shared';
import type { ClientMessage, ServerMessage } from '@lumiis/shared';
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
        view.players = message.players;
        break;
      case 'pong':
        view.pingMs = Math.max(0, Math.round(performance.now() - message.at));
        break;
      case 'notice':
        view.notice = message.text;
        break;
    }
  }
}
