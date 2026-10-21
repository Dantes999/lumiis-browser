// The graphic style packs are data: if a sheet is missing or its grid is off,
// the game would draw garbage at runtime. These tests catch that on the build.

import { describe, expect, it } from 'vitest';
import { checkAll } from '../../../tools/check-art.mjs';

describe('graphic style packs', () => {
  const reports = checkAll();

  it('ships at least one pack', () => {
    expect(reports.length).toBeGreaterThan(0);
  });

  it('has every sheet of every pack at the right grid', () => {
    for (const report of reports) {
      expect(report.errors, `${report.id}: ${report.errors.join('; ')}`).toEqual([]);
      // Body, head, hair and at least one weapon and one armour.
      expect(report.sheets.length, report.id).toBeGreaterThan(4);
    }
  });

  it('has a body sheet that is taller than one row (a real sprite sheet)', () => {
    for (const report of reports) {
      const body = report.sheets.find((sheet) => sheet.key === 'body');
      expect(body?.rows ?? 0, report.id).toBeGreaterThan(5);
    }
  });
});
