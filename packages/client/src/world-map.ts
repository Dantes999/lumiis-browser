// The map the client is currently playing on.
//
// It comes from the same json the server loaded, so collision and rendering use
// one source. Until it arrives nothing moves, which is the safe default.

import { spawnPosition, type MapData } from '@lumiis/shared';
import { view } from './state';

let current: MapData | null = null;

export const getWorldMap = (): MapData | null => current;

export function setWorldMap(map: MapData): void {
  current = map;

  // Place the local figure before the first snapshot arrives, so the camera
  // does not start in the corner of the world.
  if (view.selfId === null) {
    const spawn = spawnPosition(map);
    view.self.x = spawn.x;
    view.self.y = spawn.y;
    view.self.prevX = spawn.x;
    view.self.prevY = spawn.y;
  }
}
