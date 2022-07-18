import {computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {IChainForkConfig} from "@lodestar/config";
import {IForkChoice} from "@lodestar/fork-choice";
import {allForks, Slot} from "@lodestar/types";
import {toHexString} from "@lodestar/utils";
import {IBeaconClock} from "../clock/interface.js";
import {BlockError, BlockErrorCode} from "../errors/index.js";
import {ImportBlockOpts} from "./types.js";

/**
 * Verifies some early cheap sanity checks on the block before running the full state transition.
 *
 * - Parent is known to the fork-choice
 * - Check skipped slots limit
 * - check_block_relevancy()
 *   - Block not in the future
 *   - Not genesis block
 *   - Block's slot is < Infinity
 *   - Not finalized slot
 *   - Not already known
 */
export function verifyBlocksSanityChecks(
  chain: {forkChoice: IForkChoice; clock: IBeaconClock; config: IChainForkConfig},
  blocks: allForks.SignedBeaconBlock[],
  opts: ImportBlockOpts
): {relevantBlocks: allForks.SignedBeaconBlock[]; parentSlots: Slot[]} {
  if (blocks.length === 0) {
    throw Error("Empty partiallyVerifiedBlocks");
  }

  const relevantBlocks: allForks.SignedBeaconBlock[] = [];
  const parentSlots: Slot[] = [];

  for (const block of blocks) {
    const blockSlot = block.message.slot;

    // Not genesis block
    // IGNORE if `partiallyVerifiedBlock.ignoreIfKnown`
    if (blockSlot === 0) {
      if (opts.ignoreIfKnown) {
        continue;
      } else {
        throw new BlockError(block, {code: BlockErrorCode.GENESIS_BLOCK});
      }
    }

    // Not finalized slot
    // IGNORE if `partiallyVerifiedBlock.ignoreIfFinalized`
    const finalizedSlot = computeStartSlotAtEpoch(chain.forkChoice.getFinalizedCheckpoint().epoch);
    if (blockSlot <= finalizedSlot) {
      if (opts.ignoreIfFinalized) {
        continue;
      } else {
        throw new BlockError(block, {code: BlockErrorCode.WOULD_REVERT_FINALIZED_SLOT, blockSlot, finalizedSlot});
      }
    }

    let parentBlockSlot: Slot;

    // When importing a block segment, only the first NON-IGNORED block must be known to the fork-choice.
    if (relevantBlocks.length > 0) {
      parentBlockSlot = relevantBlocks[relevantBlocks.length - 1].message.slot;
    } else {
      // Parent is known to the fork-choice
      const parentRoot = toHexString(block.message.parentRoot);
      const parentBlock = chain.forkChoice.getBlockHex(parentRoot);
      if (!parentBlock) {
        throw new BlockError(block, {code: BlockErrorCode.PARENT_UNKNOWN, parentRoot});
      } else {
        parentBlockSlot = parentBlock.slot;
      }
    }

    // Block not in the future, also checks for infinity
    const currentSlot = chain.clock.currentSlot;
    if (blockSlot > currentSlot) {
      throw new BlockError(block, {code: BlockErrorCode.FUTURE_SLOT, blockSlot, currentSlot});
    }

    // Not already known
    // IGNORE if `partiallyVerifiedBlock.ignoreIfKnown`
    const blockHash = toHexString(
      chain.config.getForkTypes(block.message.slot).BeaconBlock.hashTreeRoot(block.message)
    );
    if (chain.forkChoice.hasBlockHex(blockHash)) {
      if (opts.ignoreIfKnown) {
        continue;
      } else {
        throw new BlockError(block, {code: BlockErrorCode.ALREADY_KNOWN, root: blockHash});
      }
    }

    // Block is relevant
    relevantBlocks.push(block);
    parentSlots.push(parentBlockSlot);
  }

  return {relevantBlocks, parentSlots};
}
