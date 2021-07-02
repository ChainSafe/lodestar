import {computeEpochAtSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {allForks, Epoch} from "@chainsafe/lodestar-types";

/**
 * Groups blocks by ascending epoch
 * ```js
 * // SLOTS_PER_EPOCH = 4
 * [[0,1,2,3], [5,7], [8,9,10], ...]
 * ```
 */
export function groupBlocksByEpoch(blocks: allForks.SignedBeaconBlock[]): allForks.SignedBeaconBlock[][] {
  const blocksByEpoch = new Map<Epoch, allForks.SignedBeaconBlock[]>();

  for (const block of blocks) {
    const epoch = computeEpochAtSlot(block.message.slot);
    let blocksInEpoch = blocksByEpoch.get(epoch);
    if (!blocksInEpoch) blocksInEpoch = [];
    blocksInEpoch.push(block);
    blocksByEpoch.set(epoch, blocksInEpoch);
  }

  return Array.from(blocksByEpoch.values());
}
