// Picking things up.
//
// Nothing is collected on its own unless the player switched auto pickup on.
// Otherwise the player orders one item: tap it, walk there, take it.

import { PICKUP_RANGE } from '@lumiis/shared';
import { view, type GroundItemState } from './state';

let sender: (itemId: number) => void = () => {};
/** The item the player asked for; kept until it is taken or gone. */
let order: number | null = null;

export const setPickupSender = (fn: (itemId: number) => void): void => {
  sender = fn;
};

export const pickupOrder = (): number | null => order;

/** Tap on an item: remember it and take it as soon as we are close enough. */
export function orderPickup(itemId: number): void {
  order = itemId;
  tryOrder();
}

export function cancelPickup(): void {
  order = null;
}

/** Called every frame: takes the ordered item once the player is in reach. */
export function tickPickup(): void {
  if (order === null) return;

  const item = view.ground.get(order);
  if (item === undefined) {
    order = null;
    return;
  }
  tryOrder();
}

/** Y key: take the closest item that is already within reach. */
export function pickupNearestInRange(): boolean {  let best: number | null = null;
  let bestDistance = PICKUP_RANGE;

  for (const item of view.ground.values()) {
    const distance = Math.hypot(item.x - view.self.x, item.y - view.self.y);
    if (distance <= bestDistance) {
      best = item.id;
      bestDistance = distance;
    }
  }

  if (best === null) return false;

  sender(best);
  return true;
}

/** The ground item closest to a world point, if one is close enough to tap. */
export function itemNear(worldX: number, worldY: number, radius = 18): GroundItemState | null {
  let best: GroundItemState | null = null;
  let bestDistance = radius;

  for (const item of view.ground.values()) {
    const distance = Math.hypot(item.x - worldX, item.y - worldY);
    if (distance <= bestDistance) {
      best = item;
      bestDistance = distance;
    }
  }
  return best;
}

function tryOrder(): void {  if (order === null) return;

  const item = view.ground.get(order);
  if (item === undefined) {
    order = null;
    return;
  }

  const distance = Math.hypot(item.x - view.self.x, item.y - view.self.y);
  if (distance > PICKUP_RANGE) return;

  sender(item.id);
  order = null;
}
