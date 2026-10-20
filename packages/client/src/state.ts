// Everything the UI draws comes from here. One small mutable object instead of
// a framework: the network writes into it, the scenes read from it.

import type { PlayerSnapshot } from '@lumiis/shared';

export type ConnectionStatus = 'connecting' | 'online' | 'offline';

export type ViewState = {
  status: ConnectionStatus;
  tick: number;
  pingMs: number | null;
  players: PlayerSnapshot[];
  selfId: number | null;
  notice: string | null;
};

export const view: ViewState = {
  status: 'connecting',
  tick: 0,
  pingMs: null,
  players: [],
  selfId: null,
  notice: null,
};
