// A tiny log that both the console and the in-game log window read.
//
// Written for exactly the situation where a second machine stops working and
// there is no dev console open: every connection event ends up in a ring
// buffer that the Log window can show and copy.

export type LogLevel = 'info' | 'warn' | 'error';

export type LogEntry = {
  at: number;
  level: LogLevel;
  text: string;
};

const MAX_LINES = 300;
const entries: LogEntry[] = [];
const listeners = new Set<(entry: LogEntry) => void>();

let forwarder: ((entry: LogEntry) => void) | null = null;

/** Sends every line to the server too, so it shows up in the server terminal. */
export const setLogForwarder = (fn: ((entry: LogEntry) => void) | null): void => {
  forwarder = fn;
};

/** Adds a line to the console and to the in-game log. */
export function logEvent(level: LogLevel, text: string): void {
  const entry: LogEntry = { at: Date.now(), level, text };
  entries.push(entry);
  if (entries.length > MAX_LINES) entries.shift();

  const stamp = new Date(entry.at).toLocaleTimeString();
  const line = `[${stamp}] ${text}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);

  for (const listener of listeners) listener(entry);
  forwarder?.(entry);
}

/** Everything logged so far, oldest first. */
export const logEntries = (): readonly LogEntry[] => entries;

/** Subscribes to new lines; returns the unsubscribe function. */
export function onLog(listener: (entry: LogEntry) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The whole log as plain text, for the copy button. */
export const logText = (): string =>
  entries
    .map((entry) => `[${new Date(entry.at).toLocaleTimeString()}] ${entry.level}: ${entry.text}`)
    .join('\n');
