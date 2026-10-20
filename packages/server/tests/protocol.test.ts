import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, parseClientMessage } from '@lumiis/shared';

describe('protocol', () => {
  it('accepts a hello with a valid name and version', () => {
    const result = parseClientMessage({ t: 'hello', v: PROTOCOL_VERSION, name: 'Kain' });
    expect(result).toEqual({ ok: true, message: { t: 'hello', v: PROTOCOL_VERSION, name: 'Kain' } });
  });

  it('rejects a hello from a different protocol version', () => {
    const result = parseClientMessage({ t: 'hello', v: PROTOCOL_VERSION + 1, name: 'Kain' });
    expect(result.ok).toBe(false);
  });

  it('rejects names that break the name rule', () => {
    for (const name of ['ab', 'a'.repeat(17), 'bad name', 'kain!', '', 42]) {
      expect(parseClientMessage({ t: 'hello', v: PROTOCOL_VERSION, name }).ok).toBe(false);
    }
  });

  it('accepts a ping with a numeric timestamp', () => {
    expect(parseClientMessage({ t: 'ping', at: 1234 })).toEqual({
      ok: true,
      message: { t: 'ping', at: 1234 },
    });
  });

  it('accepts movement input in whole steps', () => {
    expect(parseClientMessage({ t: 'input', dx: -1, dy: 1 })).toEqual({
      ok: true,
      message: { t: 'input', dx: -1, dy: 1 },
    });
    expect(parseClientMessage({ t: 'input', dx: 0, dy: 0 })).toEqual({
      ok: true,
      message: { t: 'input', dx: 0, dy: 0 },
    });
  });

  it('rejects input that is not a whole step', () => {
    for (const bad of [
      { t: 'input', dx: 2, dy: 0 },
      { t: 'input', dx: 0.5, dy: 0 },
      { t: 'input', dx: -2, dy: 0 },
      { t: 'input', dx: '1', dy: 0 },
      { t: 'input', dx: 1 },
      { t: 'input' },
    ]) {
      expect(parseClientMessage(bad).ok).toBe(false);
    }
  });

  it('rejects a ping without a usable timestamp', () => {
    expect(parseClientMessage({ t: 'ping' }).ok).toBe(false);
    expect(parseClientMessage({ t: 'ping', at: Number.NaN }).ok).toBe(false);
    expect(parseClientMessage({ t: 'ping', at: '1' }).ok).toBe(false);
  });

  it('rejects unknown message types', () => {
    expect(parseClientMessage({ t: 'teleport', x: 1, y: 1 }).ok).toBe(false);
  });

  it('rejects anything that is not a plain object', () => {
    for (const input of [null, undefined, 1, 'hello', [], true]) {
      expect(parseClientMessage(input).ok).toBe(false);
    }
  });
});
