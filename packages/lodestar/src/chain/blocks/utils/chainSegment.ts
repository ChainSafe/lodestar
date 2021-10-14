import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {allForks, ssz} from "@chainsafe/lodestar-types";
import {BlockError, BlockErrorCode} from "../../errors";

/**
 * Assert this chain segment of blocks is linear with slot numbers and hashes
 */
export function assertLinearChainSegment(config: IChainForkConfig, blocks: allForks.SignedBeaconBlock[]): void {
  for (const [i, block] of blocks.entries()) {
    const child = blocks[i + 1];
    if (child !== undefined) {
      // If this block has a child in this chain segment, ensure that its parent root matches
      // the root of this block.
      if (
        !ssz.Root.equals(
          config.getForkTypes(block.message.slot).BeaconBlock.hashTreeRoot(block.message),
          child.message.parentRoot
        )
      ) {
        throw new BlockError(block, {code: BlockErrorCode.NON_LINEAR_PARENT_ROOTS});
      }
      // Ensure that the slots are strictly increasing throughout the chain segment.
      if (child.message.slot <= block.message.slot) {
        throw new BlockError(block, {code: BlockErrorCode.NON_LINEAR_SLOTS});
      }
    }
  }
}
