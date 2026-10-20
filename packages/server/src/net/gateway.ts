// WebSocket gateway: one socket per player, one session per socket.
//
// Every incoming frame goes through the same path: limit, decode, validate,
// then handle. A frame that fails any step ends the connection instead of being
// guessed at.

import type { Server as HttpServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import {
  MAX_MESSAGE_BYTES,
  MAX_MESSAGES_PER_SECOND,
  PROTOCOL_VERSION,
  TICK_RATE,
  decode,
  encode,
  parseClientMessage,
} from '@lumiis/shared';
import type { InventorySlot } from '@lumiis/shared';
import type { World, Player } from '../game/world.js';

type Session = {
  socket: WebSocket;
  player: Player | null;
  tokens: number;
  tokensAt: number;
};

export type Gateway = {
  /** Sends the current world state to everyone who finished the handshake. */
  broadcastSnapshot(): void;
  /** Sends one player's inventory; used after a pickup. */
  sendInventory(playerId: number, slots: InventorySlot[]): void;
  /** Connected sockets, including those that have not said hello yet. */
  readonly connectionCount: number;
  close(): Promise<void>;
};

const refuse = (socket: WebSocket, code: number, reason: string): void => {
  socket.close(code, reason);
};

export function attachGateway(httpServer: HttpServer, world: World): Gateway {
  const wss = new WebSocketServer({
    server: httpServer,
    path: '/ws',
    maxPayload: MAX_MESSAGE_BYTES,
  });

  const sessions = new Set<Session>();

  /** Token bucket: a client gets a burst of MAX_MESSAGES_PER_SECOND and refills over time. */
  const takeToken = (session: Session, now: number): boolean => {
    const elapsed = now - session.tokensAt;
    if (elapsed > 0) {
      session.tokens = Math.min(
        MAX_MESSAGES_PER_SECOND,
        session.tokens + (elapsed / 1000) * MAX_MESSAGES_PER_SECOND,
      );
      session.tokensAt = now;
    }
    if (session.tokens < 1) return false;
    session.tokens -= 1;
    return true;
  };

  const send = (session: Session, message: Parameters<typeof encode>[0]): void => {
    if (session.socket.readyState !== WebSocket.OPEN) return;
    session.socket.send(encode(message));
  };

  /** Finds the session of a player, so rewards can reach every contributor. */
  const sendToPlayer = (playerId: number, message: Parameters<typeof encode>[0]): void => {
    for (const session of sessions) {
      if (session.player?.id !== playerId) continue;
      send(session, message);
      return;
    }
  };

  const sendInventory = (session: Session, playerId: number): void => {
    const slots = world.inventoryOf(playerId);
    if (slots !== null) send(session, { t: 'inventory', slots });
  };

  const handleHello = (session: Session, name: string): void => {
    if (session.player !== null) {
      send(session, { t: 'notice', text: 'Already logged in.' });
      return;
    }
    const player = world.addPlayer(name);
    session.player = player;
    send(session, {
      t: 'welcome',
      id: player.id,
      protocol: PROTOCOL_VERSION,
      tickRate: TICK_RATE,
      tick: world.tick,
    });
    sendInventory(session, player.id);
  };

  wss.on('connection', (socket) => {
    const session: Session = {
      socket,
      player: null,
      tokens: MAX_MESSAGES_PER_SECOND,
      tokensAt: performance.now(),
    };
    sessions.add(session);

    socket.on('message', (data, isBinary) => {
      if (isBinary) {
        refuse(socket, 1003, 'text frames only');
        return;
      }

      if (!takeToken(session, performance.now())) {
        refuse(socket, 1008, 'rate limit');
        return;
      }

      const parsed = parseClientMessage(decode(data.toString()));
      if (!parsed.ok) {
        send(session, { t: 'notice', text: parsed.reason });
        refuse(socket, 1002, parsed.reason);
        return;
      }

      switch (parsed.message.t) {
        case 'hello':
          handleHello(session, parsed.message.name);
          break;
        case 'input':
          if (session.player === null) {
            send(session, { t: 'notice', text: 'Say hello before moving.' });
            break;
          }
          world.setInput(session.player.id, parsed.message.dx, parsed.message.dy);
          break;
        case 'attack': {
          if (session.player === null) {
            send(session, { t: 'notice', text: 'Say hello before fighting.' });
            break;
          }          const result = world.attack(session.player.id, parsed.message.target);
          if (!result.ok) {
            send(session, { t: 'notice', text: result.reason });
            break;
          }
          if (result.killed && result.rewards !== undefined) {
            for (const reward of result.rewards) {
              const level = world.getPlayer(reward.playerId)?.level ?? 1;
              const prefix = reward.levelUps > 0 ? `Level ${level}! ` : '';
              sendToPlayer(reward.playerId, {
                t: 'notice',
                text: `${prefix}+${reward.exp} EXP, +${reward.yang} Yang`,
              });
            }
          }
          break;
        }
        case 'pickup': {
          if (session.player === null) {
            send(session, { t: 'notice', text: 'Say hello before picking things up.' });
            break;
          }
          const result = world.pickup(session.player.id, parsed.message.target);
          if (!result.ok) send(session, { t: 'notice', text: result.reason });
          break;
        }
        case 'settings': {
          if (session.player === null) break;
          world.setPickupSettings(
            session.player.id,
            parsed.message.autoPickup,
            parsed.message.autoPickupTypes,
          );
          break;
        }
        case 'ping':
          send(session, { t: 'pong', at: parsed.message.at });
          break;
      }
    });

    socket.on('close', () => {
      sessions.delete(session);
      if (session.player !== null) world.removePlayer(session.player.id);
    });

    socket.on('error', () => {
      // A broken socket is not a server problem; close() follows anyway.
      socket.terminate();
    });
  });

  return {
    broadcastSnapshot(): void {
      const snapshot = world.snapshot();
      const message = encode({
        t: 'snapshot',
        tick: world.tick,
        players: snapshot.players,
        monsters: snapshot.monsters,
        ground: snapshot.ground,
      });
      for (const session of sessions) {
        if (session.player === null) continue;
        if (session.socket.readyState !== WebSocket.OPEN) continue;
        session.socket.send(message);
      }
    },

    get connectionCount(): number {
      return sessions.size;
    },

    sendInventory(playerId: number, slots: InventorySlot[]): void {
      sendToPlayer(playerId, { t: 'inventory', slots });
    },

    close(): Promise<void> {
      return new Promise((resolve) => {
        for (const session of sessions) session.socket.terminate();
        sessions.clear();
        wss.close(() => resolve());
      });
    },
  };
}
