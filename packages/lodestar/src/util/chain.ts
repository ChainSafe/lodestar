import {phase0} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Root} from "@chainsafe/lodestar-types";
import {toHexString} from "@chainsafe/ssz";

/**
 * Check each block should link to a previous parent block and be a parent of next block.
 * Throw errors if they're not so that it'll fetch again
 */
export function checkLinearChainSegment(
  config: IBeaconConfig,
  blocks: phase0.SignedBeaconBlock[] | null,
  ancestorRoot: Root | null = null
): void {
  if (!blocks || blocks.length <= 1) throw new Error("Not enough blocks to validate");
  let parentRoot = ancestorRoot;
  for (const block of blocks) {
    if (parentRoot && !config.types.Root.equals(block.message.parentRoot, parentRoot)) {
      throw new Error(`Block ${block.message.slot} does not link to parent ${toHexString(parentRoot)}`);
    }
    parentRoot = config.types.phase0.BeaconBlock.hashTreeRoot(block.message);
  }
}
