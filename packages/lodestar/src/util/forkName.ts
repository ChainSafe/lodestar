import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ForkName} from "@chainsafe/lodestar-params";
import {Slot} from "@chainsafe/lodestar-types";

/**
 * Group an array of items by ForkName according to the slot associted to each item
 */
export function groupByFork<T>(config: IBeaconConfig, items: T[], getSlot: (item: T) => Slot): Map<ForkName, T[]> {
  const itemsByFork = new Map<ForkName, T[]>();
  for (const item of items) {
    const forkName = config.getForkName(getSlot(item));
    let itemsInFork = itemsByFork.get(forkName);
    if (!itemsInFork) {
      itemsInFork = [];
      itemsByFork.set(forkName, itemsInFork);
    }
    itemsInFork.push(item);
  }
  return itemsByFork;
}
