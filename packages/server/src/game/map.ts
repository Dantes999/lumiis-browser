// Loading a map from disk. A broken map stops the server at startup instead of
// letting players walk through walls that only exist in the file.

import { readFileSync } from 'node:fs';
import { validateMap, type MapData } from '@lumiis/shared';

export function loadMap(filePath: string): MapData {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`cannot read map ${filePath}: ${(error as Error).message}`);
  }

  const check = validateMap(raw);
  if (!check.ok) {
    throw new Error(`map ${filePath} is invalid:\n  ${check.errors.join('\n  ')}`);
  }
  return check.map;
}
