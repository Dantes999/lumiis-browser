// Fixed numbers shared by server and client.
// Everything the simulation does is expressed in ticks, never in milliseconds.

/** Server simulation rate in ticks per second. One tick is one step of the world. */
export const TICK_RATE = 20;

/** Duration of one tick in milliseconds. Only used for timers, never for game rules. */
export const TICK_MS = 1000 / TICK_RATE;

/** How many ticks pass between two snapshots sent to clients. */
export const SNAPSHOT_EVERY_TICKS = 2;

/** A connection that falls more than this many ticks behind is skipped, not caught up. */
export const MAX_CATCH_UP_TICKS = 5;

// Hard limits. Everything outside them is rejected before it reaches the game.

/** Largest accepted WebSocket message in bytes. */
export const MAX_MESSAGE_BYTES = 2048;

/** Messages per second a single connection may send. */
export const MAX_MESSAGES_PER_SECOND = 60;

/** Name rules: 3 to 16 characters, letters, digits and underscore. */
export const MIN_NAME_LENGTH = 3;
export const MAX_NAME_LENGTH = 16;
export const NAME_PATTERN = /^[A-Za-z0-9_]{3,16}$/;

/** Password rules. Long enough to matter, short enough to type on a phone. */
export const MIN_PASSWORD_LENGTH = 6;
export const MAX_PASSWORD_LENGTH = 64;

/** Bumped whenever the message shapes below change in an incompatible way. */
export const PROTOCOL_VERSION = 2;

/** World size of the first test map in tiles. Real maps replace this later. */
export const TILE_SIZE = 32;

/** The map a new character starts on (the first real world). */
export const START_MAP = 'greenfield';
