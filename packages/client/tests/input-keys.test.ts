import { describe, expect, it } from 'vitest';
import { blocksGameKeys } from '../src/input';

describe('keyboard focus', () => {
  it('lets the game use the keyboard on the world', () => {
    expect(blocksGameKeys('BODY', false, false)).toBe(false);
    expect(blocksGameKeys('CANVAS', false, false)).toBe(false);
  });

  it('keeps its hands off text fields', () => {
    for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) {
      expect(blocksGameKeys(tag, false, false)).toBe(true);
    }
    expect(blocksGameKeys('DIV', true, false)).toBe(true);
  });

  it('ignores the keyboard while a menu is open', () => {
    expect(blocksGameKeys('BODY', false, true)).toBe(true);
  });
});
