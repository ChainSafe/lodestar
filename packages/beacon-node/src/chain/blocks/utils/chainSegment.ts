import {ChainForkConfig} from "@lodestar/config";
import {ssz} from "@lodestar/types";
import {BlockError, BlockErrorCode} from "../../errors/index.js";
import {IBlockInput} from "../blockInput/types.js";

/**
 * Assert this chain segment of blocks is linear with slot numbers and hashes
 */

export function assertLinearChainSegment(config: ChainForkConfig, blocks: IBlockInput[]): void {
  for (let i = 0; i < blocks.length - 1; i++) {
    const block = blocks[i].getBlock();
    const child = blocks[i + 1].getBlock();
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
