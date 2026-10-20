import { describe, expect, it } from 'vitest';
import { MAX_LEVEL, expForNextLevel } from '@lumiis/shared';

describe('experience curve', () => {
  it('starts with a small step', () => {
    expect(expForNextLevel(1)).toBe(50);
  });

  it('needs more experience for every level', () => {
    for (let level = 1; level < MAX_LEVEL - 1; level += 1) {
      expect(expForNextLevel(level + 1)).toBeGreaterThan(expForNextLevel(level));
    }
  });

  it('has no next level at the maximum', () => {
    expect(expForNextLevel(MAX_LEVEL)).toBe(Number.POSITIVE_INFINITY);
    expect(expForNextLevel(MAX_LEVEL + 5)).toBe(Number.POSITIVE_INFINITY);
  });
});
