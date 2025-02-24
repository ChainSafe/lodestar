import {BlockError, BlockErrorCode} from "../../errors/index.js";
import {BlockInput} from "../utils/blockInput.js";

/**
 * Assert this chain segment of blocks is linear with slot numbers and hashes
 */
export function assertLinearChainSegment(blocks: BlockInput[]): void {
  for (let i = 0; i < blocks.length - 1; i++) {
    const block = blocks[i];
    const child = blocks[i + 1];
    // If this block has a child in this chain segment, ensure that its parent root matches
    // the root of this block.
    if (block.rootHex !== child.getParentRootHex()) {
      throw new BlockError(block, {code: BlockErrorCode.NON_LINEAR_PARENT_ROOTS});
    }
    // Ensure that the slots are strictly increasing throughout the chain segment.
    if (child.message.slot <= block.message.slot) {
      throw new BlockError(block, {code: BlockErrorCode.NON_LINEAR_SLOTS});
    }
  }
}
