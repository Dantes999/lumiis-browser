// The graphic style packs are data: if a sheet is missing or its grid is off,
// the game would draw garbage at runtime. These tests catch that on the build.

import { describe, expect, it } from 'vitest';
import { assetFile, checkAll, checkMonsters, decodePng } from '../../../tools/check-art.mjs';

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

  it('has every monster sheet at 40x32 with four views of five frames', () => {
    const report = checkMonsters();
    expect(report.errors, report.errors.join('; ')).toEqual([]);
    expect(report.sheets.length).toBeGreaterThan(0);
    for (const sheet of report.sheets) {
      expect(sheet.width, sheet.key).toBe(report.cellW * report.frames);
      expect(sheet.height, sheet.key).toBe(report.cellH * report.views);
    }
  });

  it('reads the pixels of a sheet (anchor and empty-frame checks depend on it)', () => {
    const report = reports[0];
    if (report === undefined) throw new Error('kein Paket in styles.json');
    const body = report.sheets.find((sheet) => sheet.key.startsWith('body'));
    if (body === undefined) throw new Error('kein Körper-Sheet im Paket');
    const image = decodePng(assetFile(body.url));
    if (image === null) throw new Error(`${body.url} ist nicht lesbar`);
    expect(image.width).toBe(report.cell * report.columns);
    expect(image.height % report.cell).toBe(0);
    expect(image.data.length).toBe(image.width * image.height * 4);
  });

  it('has a body sheet with the three views (down, right, up)', () => {
    for (const report of reports) {
      const body = report.sheets.find((sheet) => sheet.key.startsWith('body'));
      // The old pack has many more rows; a static placeholder needs three.
      expect(body?.rows ?? 0, report.id).toBeGreaterThanOrEqual(3);
    }
  });
});
