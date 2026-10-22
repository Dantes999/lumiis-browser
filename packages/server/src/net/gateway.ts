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
import type { GameHost, JoinedPlayer } from '../shard/host.js';
import { signToken, verifyToken } from '../store/token.js';
import { MAX_CHARACTERS, type Store } from '../store/db.js';

type Session = {
  socket: WebSocket;
  player: JoinedPlayer | null;
  tokens: number;
  tokensAt: number;
  /** Failed logins on this connection, to slow down guessing. */
  loginAttempts: number;
  /** Set after a successful login, before a character is chosen. */
  accountId: number | null;
  /** Remote address, so two clients can be told apart in the log. */
  address: string;
  /** When the last chat line was accepted, for the throttle. */
  chatAt: number;
};

export type Gateway = {
  /** Sends the current world state to everyone who is logged in; bytes sent. */
  broadcastSnapshot(): number;
  /** Sends one player's inventory; used after a pickup. */
  sendInventory(playerId: number): void;
  /** Tells one player something; used for rewards and other tick results. */
  notify(playerId: number, text: string): void;
  /** Tells everyone in one map about a kill and who earned what. */
  broadcastReward(
    worldId: string,
    reward: { x: number; y: number; shares: Array<{ playerId: number; exp: number; yang: number }> },
  ): void;
  /** Writes a slice of the players each tick, so no tick has a save spike. */
  saveTick(): void;
  /** Writes every player and resolves when the store is up to date. */
  flush(): Promise<void>;
  /** Connected sockets, including those that have not logged in yet. */
  readonly connectionCount: number;
  close(): Promise<void>;
};

const refuse = (socket: WebSocket, code: number, reason: string): void => {
  console.log(`[ws] refused code=${code} reason=${reason}`);
  socket.close(code, reason);
};

export function attachGateway(
  httpServer: HttpServer,
  host: GameHost,
  store: Store,
  tokenSecret: Buffer,
): Gateway {
  const wss = new WebSocketServer({
    server: httpServer,
    path: '/ws',
    maxPayload: MAX_MESSAGE_BYTES,
  });

  const sessions = new Set<Session>();

  /** How often a dead connection is looked for with a websocket ping. */
  const HEARTBEAT_MS = 30000;

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
    const slots = host.inventoryOf(playerId);
    const equipment = host.equipmentOf(playerId);
    if (slots !== null && equipment !== null) send(session, { t: 'inventory', slots, equipment });
  };

  /** Chat is cheap but spammable: one line every 400 ms per connection. */
  const CHAT_INTERVAL_MS = 400;
  const openSessions = (): Session[] =>
    [...sessions].filter(
      (session) => session.player !== null && session.socket.readyState === WebSocket.OPEN,
    );

  /** Map chat stays in the world (map + channel); global crosses every world. */
  const chatRecipients = (global: boolean, worldId: string | null): Session[] =>
    openSessions().filter((session) => {
      if (global) return true;
      const player = session.player;
      return player !== null && worldId !== null && host.worldIdOf(player.id) === worldId;
    });

  /** Chat mistakes land in the chat window, not in the HUD notice slot. */
  const systemLine = (session: Session, text: string): void => {
    send(session, { t: 'chat', kind: 'system', from: '', text });
  };

  const handleChat = (session: Session, text: string): void => {
    const player = session.player;
    if (player === null) return;

    const now = Date.now();
    if (now - session.chatAt < CHAT_INTERVAL_MS) {
      systemLine(session, 'Langsamer tippen.');
      return;
    }
    session.chatAt = now;

    const trimmed = text.trim();
    if (trimmed.length === 0) return;

    // /w Name text — a private line to one player, anywhere in the world.
    if (/^\/w\s/i.test(trimmed)) {
      const rest = trimmed.slice(2).trim();
      const space = rest.indexOf(' ');
      if (space <= 0) {
        systemLine(session, 'Benutzung: /w Name Text');
        return;
      }
      const wanted = rest.slice(0, space);
      const body = rest.slice(space + 1).trim();
      if (body.length === 0) {
        systemLine(session, 'Benutzung: /w Name Text');
        return;
      }
      const target = openSessions().find(
        (entry) => entry.player !== null && entry.player.name.toLowerCase() === wanted.toLowerCase(),
      );
      const targetPlayer = target?.player;
      if (target === undefined || targetPlayer === null || targetPlayer === undefined) {
        systemLine(session, `Niemand heißt "${wanted}".`);
        return;
      }
      const line = { t: 'chat' as const, kind: 'whisper' as const, from: player.name, to: targetPlayer.name, text: body };
      send(target, line);
      send(session, line);
      console.log(`[chat whisper ${player.name} -> ${targetPlayer.name}] ${body}`);
      return;
    }

    const global = /^\/g\s/i.test(trimmed);
    const body = global ? trimmed.slice(2).trim() : trimmed;
    if (body.length === 0) return;

    const worldId = host.worldIdOf(player.id);
    const line = { t: 'chat' as const, kind: global ? ('global' as const) : ('map' as const), from: player.name, text: body };
    for (const recipient of chatRecipients(global, worldId)) send(recipient, line);
    console.log(`[chat ${global ? 'global' : 'map'} ${player.name}] ${body}`);
  };

  const MAX_LOGIN_ATTEMPTS = 6;

  const sendCharacters = (session: Session, accountId: number, token?: string): void => {
    send(session, {
      t: 'characters',
      list: store.listCharacters(accountId),
      max: MAX_CHARACTERS,
      ...(token !== undefined ? { token } : {}),
    });
  };

  /** Loads a character and puts the player into the world. */
  const enterWorld = (session: Session, characterId: number, channel = 0): void => {
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
      host.leave(old.id);
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

    const player = host.join({
      map: save.map,
      characterId,
      name: save.name,
      channel,
      seed: {
        accountId: session.accountId,
        characterId,
        name: save.name,
        body: save.body,
        hair: save.hair,
        x: save.x,
        y: save.y,
        dir: save.dir as Direction,
        hp: save.hp,
        level: save.level,
        exp: save.exp,
        yang: save.yang,
        inventory: save.inventory,
        equipment: save.equipment,
      },
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
      tick: host.tickOf(player.world),
      map: player.map,
      body: save.body,
      hair: save.hair,
      channel: player.channel,
      channelCount: player.channelCount,
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
    sendCharacters(
      session,
      result.accountId,
      signToken(result.accountId, result.name, tokenSecret),
    );
  };

  /** Logs an account in from a signed token, without the password. */
  const resume = (session: Session, token: string): void => {
    if (session.accountId !== null || session.player !== null) {
      send(session, { t: 'authError', reason: 'Already logged in.' });
      return;
    }

    const payload = verifyToken(token, tokenSecret);
    if (payload === null) {
      send(session, { t: 'authError', reason: 'Session expired, please log in.' });
      return;
    }

    session.accountId = payload.accountId;
    note(`resumed session for "${payload.name}"`);
    // Refresh the token so an active player never has to log in again.
    sendCharacters(
      session,
      payload.accountId,
      signToken(payload.accountId, payload.name, tokenSecret),
    );
  };

  const handleCreate = (session: Session, name: string, body = '', hair = ''): void => {
    if (session.accountId === null) {
      send(session, { t: 'authError', reason: 'Log in first.' });
      return;
    }

    const result = store.createCharacter(session.accountId, name, body, hair);
    if (!result.ok) {
      send(session, { t: 'authError', reason: result.reason });
      sendCharacters(session, session.accountId);
      return;
    }
    enterWorld(session, result.id);
  };

  wss.on('connection', (socket, request) => {
    const address = request.socket.remoteAddress ?? 'unknown';
    const openedAt = Date.now();
    note(`open from ${address}`);

    const session: Session = {
      socket,
      player: null,
      chatAt: 0,
      tokens: MAX_MESSAGES_PER_SECOND,
      tokensAt: performance.now(),
      loginAttempts: 0,
      accountId: null,
      address,
    };
    sessions.add(session);

    /** Messages seen on this socket, so a drop can say how far it got. */
    let messageCount = 0;
    /** Answers the heartbeat ping; a missed pong means the peer is gone. */
    let alive = true;
    let lastPongAt = Date.now();

    socket.on('pong', () => {
      alive = true;
      lastPongAt = Date.now();
    });

    const heartbeat = setInterval(() => {
      if (!alive) {
        const silent = ((Date.now() - lastPongAt) / 1000).toFixed(0);
        note(`heartbeat missed for ${session.player?.name ?? 'guest'} @ ${address} (${silent}s), terminating`);
        socket.terminate();
        return;
      }
      alive = false;
      socket.ping();
    }, HEARTBEAT_MS);

    socket.on('message', (data, isBinary) => {
      messageCount += 1;
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
          enterWorld(session, message.id, message.channel ?? 0);
          break;
        case 'channels': {
          // At the login screen the client names a character; in the world it
          // just asks for the channels of the map it is standing on.
          if (message.id !== undefined) {
            if (session.accountId === null) break;
            if (store.characterOwner(message.id) !== session.accountId) break;
            const save = store.loadCharacter(message.id);
            if (save === null) break;
            send(session, {
              t: 'channels',
              id: message.id,
              map: save.map,
              list: host.channelInfo(save.map),
            });
            break;
          }

          if (session.player === null) break;
          send(session, {
            t: 'channels',
            id: null,
            map: session.player.map,
            list: host.channelInfo(session.player.map),
          });
          break;
        }
        case 'switchChannel': {
          if (session.player === null) {
            send(session, { t: 'notice', text: 'Log in first.' });
            break;
          }
          if (message.channel === session.player.channel) break;
          if (!host.switchChannel(session.player.id, message.channel)) {
            send(session, { t: 'notice', text: 'That channel does not exist.' });
            break;
          }

          session.player.channel = message.channel;
          send(session, {
            t: 'channel',
            channel: message.channel,
            count: session.player.channelCount,
          });
          break;
        }
        case 'createCharacter':
          handleCreate(session, message.name, message.body ?? '', message.hair ?? '');
          break;
        case 'input':
          if (session.player === null) {
            send(session, { t: 'notice', text: 'Log in first.' });
            break;
          }
          host.setInput(session.player.id, message.dx, message.dy);
          break;
        case 'attack': {
          if (session.player === null) {
            send(session, { t: 'notice', text: 'Log in first.' });
            break;
          }
          // The blow lands a few ticks later; failures answer as a notice.
          host.attack(session.player.id, message.target ?? null, message.dir ?? null);
          break;
        }
        case 'skill': {
          if (session.player === null) {
            send(session, { t: 'notice', text: 'Log in first.' });
            break;
          }
          host.useSkill(session.player.id, message.key);
          break;
        }
        case 'chat': {
          if (session.player === null) {
            send(session, { t: 'notice', text: 'Log in first.' });
            break;
          }
          handleChat(session, message.text);
          break;
        }
        case 'equip': {
          if (session.player === null) {
            send(session, { t: 'notice', text: 'Log in first.' });
            break;
          }
          host.equip(session.player.id, message.slot);
          break;
        }
        case 'unequip': {
          if (session.player === null) {
            send(session, { t: 'notice', text: 'Log in first.' });
            break;
          }
          host.unequip(session.player.id, message.piece);
          break;
        }
        case 'pickup': {
          if (session.player === null) {
            send(session, { t: 'notice', text: 'Log in first.' });
            break;
          }
          host.pickup(session.player.id, message.target);
          break;
        }
        case 'settings': {
          if (session.player === null) break;
          host.setPickupSettings(session.player.id, message.autoPickup, message.autoPickupTypes);
          break;
        }
        case 'resume':
          resume(session, message.token);
          break;
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
      clearInterval(heartbeat);
      sessions.delete(session);
      const seconds = ((Date.now() - openedAt) / 1000).toFixed(1);
      const who = session.player?.name ?? (session.accountId === null ? 'guest' : 'account');
      note(
        `closed ${who} @ ${address} after ${seconds}s / ${messageCount} messages, ` +
          `code=${code} reason=${reason.toString() || '-'}`,
      );

      const player = session.player;
      if (player === null) return;
      host.leave(player.id);
    });

    socket.on('error', (error) => {
      // This used to be swallowed. A dropped client needs the reason in the log.
      note(
        `socket error for ${session.player?.name ?? 'guest'} @ ${address}: ` +
          `${(error as Error).message}`,
      );
      socket.terminate();
    });
  });

  return {
    broadcastSnapshot(): number {
      const snapshots = new Map(host.drainSnapshots());
      let bytes = 0;

      for (const session of sessions) {
        if (session.player === null) continue;
        if (session.socket.readyState !== WebSocket.OPEN) continue;

        // Already UTF-8: one buffer per cell is shared by every player in it,
        // so nothing is re-encoded per socket.
        const payload = snapshots.get(session.player.id);
        if (payload === undefined) continue;

        // binary: false keeps it a text frame, so the browser gets a string.
        session.socket.send(payload, { binary: false });
        bytes += payload.length;
      }

      return bytes;
    },

    get connectionCount(): number {
      return sessions.size;
    },

    notify(playerId: number, text: string): void {
      sendToPlayer(playerId, { t: 'notice', text });
    },

    broadcastReward(worldId, reward): void {
      const message = encode({
        t: 'reward',
        x: Math.round(reward.x * 10) / 10,
        y: Math.round(reward.y * 10) / 10,
        shares: reward.shares.map((share) => ({
          id: share.playerId,
          exp: share.exp,
          yang: share.yang,
        })),
      });

      for (const session of sessions) {
        if (session.player === null) continue;
        if (session.socket.readyState !== WebSocket.OPEN) continue;
        if (host.worldIdOf(session.player.id) !== worldId) continue;
        session.socket.send(message);
      }
    },

    sendInventory(playerId: number): void {
      const session = [...sessions].find((entry) => entry.player?.id === playerId);
      if (session !== undefined) sendInventory(session, playerId);
    },

    saveTick(): void {
      host.saveTick();
    },

    flush(): Promise<void> {
      return host.flush();
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
