import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {computeEpochAtSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {Epoch, phase0} from "@chainsafe/lodestar-types";

/**
 * Groups blocks by ascending epoch
 * ```js
 * // SLOTS_PER_EPOCH = 4
 * [[0,1,2,3], [5,7], [8,9,10], ...]
 * ```
 */
export function groupBlocksByEpoch(
  config: IBeaconConfig,
  blocks: phase0.SignedBeaconBlock[]
): phase0.SignedBeaconBlock[][] {
  const blocksByEpoch = new Map<Epoch, phase0.SignedBeaconBlock[]>();

  for (const block of blocks) {
    const epoch = computeEpochAtSlot(config, block.message.slot);
    let blocksInEpoch = blocksByEpoch.get(epoch);
    if (!blocksInEpoch) blocksInEpoch = [];
    blocksInEpoch.push(block);
    blocksByEpoch.set(epoch, blocksInEpoch);
  }

  return Array.from(blocksByEpoch.values());
}
