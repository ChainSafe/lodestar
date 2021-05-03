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

export function computeMostCommonTarget(targets: ChainTarget[]): ChainTarget | null {
  const targetsById = new Map<string, ChainTarget>();
  const countById = new Map<string, number>();

  for (const target of targets) {
    const targetId = `${target.slot}-${toHexString(target.root)}`;
    targetsById.set(targetId, target);
    countById.set(targetId, 1 + (countById.get(targetId) ?? 0));
  }

  let mostCommon: {count: number; targetId: string} | null = null;
  for (const [targetId, count] of countById.entries()) {
    if (!mostCommon || count > mostCommon.count) {
      mostCommon = {count, targetId};
    }
  }

  return mostCommon && (targetsById.get(mostCommon.targetId) ?? null);
}
