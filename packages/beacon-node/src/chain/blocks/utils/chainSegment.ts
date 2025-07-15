import {BlockError, BlockErrorCode} from "../../errors/index.js";
import {BlockInput} from "../utils/blockInput.js";

/**
 * Assert this chain segment of blocks is linear with slot numbers and hashes
 */
export function assertLinearChainSegment(blocks: BlockInput[]): void {
  for (let i = 0; i < blocks.length - 1; i++) {
    const blockInput = blocks[i];
    const block = blockInput.getBlock().block;
    const childBlockInput = blocks[i + 1];
    const child = childBlockInput.getBlock().block;
    // If this block has a child in this chain segment, ensure that its parent root matches
    // the root of this block.
    if (blockInput.rootHex !== childBlockInput.getParentRootHex()) {
      throw new BlockError(block, {code: BlockErrorCode.NON_LINEAR_PARENT_ROOTS});
    }
    // Ensure that the slots are strictly increasing throughout the chain segment.
    if (child.message.slot <= block.message.slot) {
      throw new BlockError(block, {code: BlockErrorCode.NON_LINEAR_SLOTS});
    }
  }
}
