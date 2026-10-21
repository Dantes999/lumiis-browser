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
import type { ClientMessage, Direction, InventorySlot } from '@lumiis/shared';
import type { Player } from '../game/world.js';
import type { Realm } from '../game/realm.js';
import { MAX_CHARACTERS, type Store } from '../store/db.js';

type Session = {
  socket: WebSocket;
  player: Player | null;
  tokens: number;
  tokensAt: number;
  /** Failed logins on this connection, to slow down guessing. */
  loginAttempts: number;
  /** Set after a successful login, before a character is chosen. */
  accountId: number | null;
  /** Remote address, so two clients can be told apart in the log. */
  address: string;
};

export type Gateway = {
  /** Sends the current world state to everyone who is logged in. */
  broadcastSnapshot(): void;
  /** Sends one player's inventory; used after a pickup. */
  sendInventory(playerId: number): void;
  /** Tells one player something; used for rewards and other tick results. */
  notify(playerId: number, text: string): void;
  /** Writes every logged in character to the store. */
  saveAll(): void;
  /** Connected sockets, including those that have not logged in yet. */
  readonly connectionCount: number;
  close(): Promise<void>;
};

const refuse = (socket: WebSocket, code: number, reason: string): void => {
  console.log(`[ws] refused code=${code} reason=${reason}`);
  socket.close(code, reason);
};

export function attachGateway(httpServer: HttpServer, realm: Realm, store: Store): Gateway {
  const wss = new WebSocketServer({
    server: httpServer,
    path: '/ws',
    maxPayload: MAX_MESSAGE_BYTES,
  });

  const sessions = new Set<Session>();

  /** One line per connection event, so a dropped client leaves a trace. */
  const note = (text: string): void => {
    console.log(`[ws] ${text}`);
  };

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
    const slots = realm.inventoryOf(playerId);
    const equipment = realm.equipmentOf(playerId);
    if (slots !== null && equipment !== null) send(session, { t: 'inventory', slots, equipment });
  };

  const MAX_LOGIN_ATTEMPTS = 6;

  const savePlayer = (player: Player): void => {
    const state = realm.saveOf(player.id);
    if (state !== null) store.saveCharacter(player.characterId, state);
  };

  const sendCharacters = (session: Session, accountId: number): void => {
    send(session, { t: 'characters', list: store.listCharacters(accountId), max: MAX_CHARACTERS });
  };

  /** Loads a character and puts the player into the world. */
  const enterWorld = (session: Session, characterId: number): void => {
    if (session.accountId === null || session.player !== null) return;
    if (store.characterOwner(characterId) !== session.accountId) {
      send(session, { t: 'authError', reason: 'That character is not yours.' });
      return;
    }

    // One character can only be in the world once. A connection that died
    // without closing leaves a body behind, so a reconnect would otherwise
    // create a twin. Save the old body, remove it, then load the fresh save.
    const stale = [...sessions].find(
      (entry) => entry !== session && entry.player?.characterId === characterId,
    );
    if (stale !== undefined && stale.player !== null) {
      const old = stale.player;
      note(`replacing a lingering session for "${old.name}"`);
      savePlayer(old);
      realm.leave(old.id);
      stale.player = null;
      try {
        stale.socket.close(4000, 'Signed in elsewhere');
      } catch {
        // The socket is already gone.
      }
    }

    const save = store.loadCharacter(characterId);
    if (save === null) {
      send(session, { t: 'authError', reason: 'That character no longer exists.' });
      return;
    }

    const player = realm.join({
      map: save.map,
      accountId: session.accountId,
      characterId,
      name: save.name,
      x: save.x,
      y: save.y,
      dir: save.dir as Direction,
      hp: save.hp,
      level: save.level,
      exp: save.exp,
      yang: save.yang,
      inventory: save.inventory,
      equipment: save.equipment,
    });

    if (player === null) {
      send(session, { t: 'authError', reason: 'The map you were on no longer exists.' });
      return;
    }

    session.player = player;
    send(session, {
      t: 'welcome',
      id: player.id,
      protocol: PROTOCOL_VERSION,
      tickRate: TICK_RATE,
      tick: realm.worldOf(player.id)?.tick ?? 0,
      map: realm.worldIdOf(player.id) ?? save.map,
    });
    sendInventory(session, player.id);
  };

  /**
   * Login and registration share one path. Hashing is asynchronous, so the game
   * loop keeps running while a password is checked.
   */
  const handleLogin = async (
    session: Session,
    message: { name: string; password: string; mode: 'login' | 'register' },
  ): Promise<void> => {
    if (session.accountId !== null || session.player !== null) {
      send(session, { t: 'authError', reason: 'Already logged in.' });
      return;
    }
    if (session.loginAttempts >= MAX_LOGIN_ATTEMPTS) {
      send(session, { t: 'authError', reason: 'Too many attempts. Reconnect and try again.' });
      return;
    }
    session.loginAttempts += 1;

    const result =
      message.mode === 'register'
        ? await store.register(message.name, message.password)
        : await store.login(message.name, message.password);

    if (session.socket.readyState !== WebSocket.OPEN) return;

    if (!result.ok) {
      send(session, { t: 'authError', reason: result.reason });
      return;
    }

    session.accountId = result.accountId;
    sendCharacters(session, result.accountId);
  };

  const handleCreate = (session: Session, name: string): void => {
    if (session.accountId === null) {
      send(session, { t: 'authError', reason: 'Log in first.' });
      return;
    }

    const result = store.createCharacter(session.accountId, name);
    if (!result.ok) {
      send(session, { t: 'authError', reason: result.reason });
      sendCharacters(session, session.accountId);
      return;
    }
    enterWorld(session, result.id);
  };

  wss.on('connection', (socket, request) => {
    const address = request.socket.remoteAddress ?? 'unknown';
    note(`open from ${address}`);

    const session: Session = {
      socket,
      player: null,
      tokens: MAX_MESSAGES_PER_SECOND,
      tokensAt: performance.now(),
      loginAttempts: 0,
      accountId: null,
      address,
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

      const decoded = decode(data.toString());
      const parsed = parseClientMessage(decoded);

      if (!parsed.ok) {
        // A rejected login is a mistake, not an attack: answer and stay open so
        // the player can correct it in the same window.
        const looksLikeLogin =
          typeof decoded === 'object' && decoded !== null && (decoded as { t?: unknown }).t === 'login';

        if (looksLikeLogin) {
          send(session, { t: 'authError', reason: parsed.reason });
          return;
        }

        send(session, { t: 'notice', text: parsed.reason });
        refuse(socket, 1002, parsed.reason);
        return;
      }

      try {
        dispatch(session, parsed.message);
      } catch (error) {
        console.error(`[ws] handler failed for "${parsed.message.t}":`, error);
        send(session, { t: 'notice', text: 'Server error, please try again.' });
      }
    });

    const dispatch = (session: Session, message: ClientMessage): void => {
      switch (message.t) {
        case 'login':
          void handleLogin(session, message);
          break;
        case 'select':
          enterWorld(session, message.id);
          break;
        case 'createCharacter':
          handleCreate(session, message.name);
          break;
        case 'input':
          if (session.player === null) {
            send(session, { t: 'notice', text: 'Log in first.' });
            break;
          }
          realm.setInput(session.player.id, message.dx, message.dy);
          break;
        case 'attack': {
          if (session.player === null) {
            send(session, { t: 'notice', text: 'Log in first.' });
            break;
          }
          // The blow lands a few ticks later; rewards follow through the tick loop.
          const result = realm.attack(
            session.player.id,
            message.target ?? null,
            message.dir ?? null,
          );
          if (!result.ok) send(session, { t: 'notice', text: result.reason });
          break;
        }
        case 'skill': {
          if (session.player === null) {
            send(session, { t: 'notice', text: 'Log in first.' });
            break;
          }
          const result = realm.useSkill(session.player.id, message.key);
          if (!result.ok) send(session, { t: 'notice', text: result.reason });
          break;
        }
        case 'equip': {
          if (session.player === null) {
            send(session, { t: 'notice', text: 'Log in first.' });
            break;
          }
          const result = realm.equip(session.player.id, message.slot);
          if (!result.ok) send(session, { t: 'notice', text: result.reason });
          break;
        }
        case 'unequip': {
          if (session.player === null) {
            send(session, { t: 'notice', text: 'Log in first.' });
            break;
          }
          const result = realm.unequip(session.player.id, message.piece);
          if (!result.ok) send(session, { t: 'notice', text: result.reason });
          break;
        }
        case 'pickup': {
          if (session.player === null) {
            send(session, { t: 'notice', text: 'Log in first.' });
            break;
          }
          const result = realm.pickup(session.player.id, message.target);
          if (!result.ok) send(session, { t: 'notice', text: result.reason });
          break;
        }
        case 'settings': {
          if (session.player === null) break;
          realm.setPickupSettings(
            session.player.id,
            message.autoPickup,
            message.autoPickupTypes,
          );
          break;
        }
        case 'log': {
          // Strip control characters so a client cannot paint the terminal.
          const clean = message.text.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 500);
          const who = session.player?.name ?? 'guest';
          console.log(`[client ${who} @ ${session.address}] ${message.level}: ${clean}`);
          break;
        }
        case 'ping':
          send(session, { t: 'pong', at: message.at });
          break;
      }
    };

    socket.on('close', (code, reason) => {
      sessions.delete(session);
      const who = session.player?.name ?? (session.accountId === null ? 'guest' : 'account');
      note(`closed ${who} code=${code} reason=${reason.toString() || '-'}`);

      const player = session.player;
      if (player === null) return;
      savePlayer(player);
      realm.leave(player.id);
    });

    socket.on('error', () => {
      // A broken socket is not a server problem; close() follows anyway.
      socket.terminate();
    });
  });

  return {
    broadcastSnapshot(): void {
      const snapshots = realm.snapshotJson();

      for (const session of sessions) {
        if (session.player === null) continue;
        if (session.socket.readyState !== WebSocket.OPEN) continue;

        const worldId = realm.worldIdOf(session.player.id);
        const message = worldId === null ? undefined : snapshots.get(worldId);
        if (message !== undefined) session.socket.send(message);
      }
    },

    get connectionCount(): number {
      return sessions.size;
    },

    notify(playerId: number, text: string): void {
      sendToPlayer(playerId, { t: 'notice', text });
    },

    sendInventory(playerId: number): void {
      const session = [...sessions].find((entry) => entry.player?.id === playerId);
      if (session !== undefined) sendInventory(session, playerId);
    },

    saveAll(): void {
      for (const session of sessions) {
        if (session.player !== null) savePlayer(session.player);
      }
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
