import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initController, resend, setManualInput } from '../src/controller';
import { view } from '../src/state';

let sent: Array<[number, number]>;
let send: ReturnType<typeof vi.fn>;

beforeEach(() => {
  sent = [];
  send = vi.fn((dx: number, dy: number) => {
    sent.push([dx, dy]);
  });
  initController(send);
  view.self = {
    x: 100,
    y: 100,
    prevX: 100,
    prevY: 100,
    name: 'Kain',
    cls: 'warrior',
    body: '',
    hair: '',
    dir: 0,
    moveDir: 0,
    moving: false,
    offsetX: 0,
    offsetY: 0,
    hp: 100,
    maxHp: 100,
    sp: 60,
    maxSp: 60,
    stats: { str: 0, vit: 0, int: 0, dex: 0 },
    points: 0,
    attack: 12,
    defense: 0,
    matk: 12,
    mdef: 0,
    level: 1,
    exp: 0,
    yang: 0,
    buffs: {},
  };
});

describe('movement intents', () => {
  it('sends manual input immediately and turns the figure', () => {
    setManualInput(1, 0);
    expect(sent).toEqual([[1, 0]]);
    expect(view.self.moving).toBe(true);
    expect(view.self.dir).toBe(6); // east
  });

  it('sends a stop when the keys are released', () => {
    setManualInput(1, 0);
    setManualInput(0, 0);
    expect(sent).toEqual([
      [1, 0],
      [0, 0],
    ]);
    expect(view.self.moving).toBe(false);
  });

  it('does not repeat an unchanged direction', () => {
    setManualInput(1, 0);
    setManualInput(1, 0);
    setManualInput(1, 0);
    expect(sent).toHaveLength(1);
  });

  it('walks diagonally when two keys are held', () => {
    setManualInput(1, -1);
    expect(view.self.dir).toBe(5); // north-east
  });

  it('sends the current intent again on request', () => {
    view.status = 'online';
    setManualInput(0, -1);
    resend();
    expect(sent).toEqual([
      [0, -1],
      [0, -1],
    ]);
  });

  it('stays quiet before the login is done', () => {
    view.status = 'connecting';
    setManualInput(0, -1);
    resend();
    expect(sent).toHaveLength(1);
  });
});
