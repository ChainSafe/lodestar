import {Root, Slot} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";

/**
 * Sync this up to this target. Uses slot instead of epoch to re-use logic for finalized sync
 * and head sync. The root is used to uniquely identify this chain on different forks
 */
export type ChainTarget = {
  slot: Slot;
  root: Root;
};

/**
 * Previously we use computeMostCommonTarget to compute the target for a chain.
 * Starting from fulu, we use computeHighestTarget to compute the target for a chain.
 */
export function computeHighestTarget(targets: ChainTarget[]): ChainTarget {
  if (targets.length === 0) {
    throw Error("Must provide at least one target");
  }

  let highestSlot = -1;
  let highestTargets: ChainTarget[] = [];
  for (const target of targets) {
    if (target.slot > highestSlot) {
      highestSlot = target.slot;
      highestTargets = [target];
    } else if (target.slot === highestSlot) {
      highestTargets.push(target);
    }
    // ignore if target.slot < highestSlot
  }

  if (highestTargets.length === 1) {
    return highestTargets[0];
  }

  return computeMostCommonTarget(highestTargets);
}

function computeMostCommonTarget(targets: ChainTarget[]): ChainTarget {
  if (targets.length === 0) {
    throw Error("Must provide at least one target");
  }

  const countById = new Map<string, number>();

  let mostCommonTarget = targets[0];
  let mostCommonCount = 0;

  for (const target of targets) {
    const targetId = `${target.slot}-${toRootHex(target.root)}`;
    const count = 1 + (countById.get(targetId) ?? 0);
    countById.set(targetId, count);
    if (count > mostCommonCount) {
      mostCommonCount = count;
      mostCommonTarget = target;
    }
  }

  return mostCommonTarget;
}
