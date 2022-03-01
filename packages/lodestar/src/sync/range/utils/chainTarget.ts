import {Root, Slot} from "@chainsafe/lodestar-types";
import {toHexString} from "@chainsafe/ssz";

/**
 * Sync this up to this target. Uses slot instead of epoch to re-use logic for finalized sync
 * and head sync. The root is used to uniquely identify this chain on different forks
 */
export type ChainTarget = {
  slot: Slot;
  root: Root;
};

export function computeMostCommonTarget(targets: ChainTarget[]): ChainTarget {
  if (targets.length === 0) {
    throw Error("Must provide at least one target");
  }

  const countById = new Map<string, number>();

  let mostCommonTarget = targets[0];
  let mostCommonCount = 0;

  for (const target of targets) {
    const targetId = `${target.slot}-${toHexString(target.root)}`;
    const count = 1 + (countById.get(targetId) ?? 0);
    countById.set(targetId, count);
    if (count > mostCommonCount) {
      mostCommonCount = count;
      mostCommonTarget = target;
    }
  }

  return mostCommonTarget;
}
