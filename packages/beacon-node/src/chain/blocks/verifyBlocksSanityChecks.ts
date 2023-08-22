import {computeStartSlotAtEpoch, DataAvailableStatus} from "@lodestar/state-transition";
import {ChainForkConfig} from "@lodestar/config";
import {IForkChoice, ProtoBlock} from "@lodestar/fork-choice";
import {Slot, deneb} from "@lodestar/types";
import {toHexString} from "@lodestar/utils";
import {IClock} from "../../util/clock.js";
import {BlockError, BlockErrorCode} from "../errors/index.js";
import {validateBlobSidecars} from "../validation/blobSidecar.js";
import {BlockInput, BlockInputType, ImportBlockOpts} from "./types.js";

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
  chain: {forkChoice: IForkChoice; clock: IClock; config: ChainForkConfig},
  blocks: BlockInput[],
  opts: ImportBlockOpts
): {
  relevantBlocks: BlockInput[];
  dataAvailabilityStatuses: DataAvailableStatus[];
  parentSlots: Slot[];
  parentBlock: ProtoBlock | null;
} {
  if (blocks.length === 0) {
    throw Error("Empty partiallyVerifiedBlocks");
  }

  const relevantBlocks: BlockInput[] = [];
  const dataAvailabilityStatuses: DataAvailableStatus[] = [];
  const parentSlots: Slot[] = [];
  let parentBlock: ProtoBlock | null = null;

  for (const blockInput of blocks) {
    const {block} = blockInput;
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

    // Validate status of only not yet finalized blocks, we don't need yet to propogate the status
    // as it is not used upstream anywhere
    const dataAvailabilityStatus = maybeValidateBlobs(chain.config, blockInput, opts);

    let parentBlockSlot: Slot;

    if (relevantBlocks.length > 0) {
      parentBlockSlot = relevantBlocks[relevantBlocks.length - 1].block.message.slot;
    } else {
      // When importing a block segment, only the first NON-IGNORED block must be known to the fork-choice.
      const parentRoot = toHexString(block.message.parentRoot);
      parentBlock = chain.forkChoice.getBlockHex(parentRoot);
      if (!parentBlock) {
        throw new BlockError(block, {code: BlockErrorCode.PARENT_UNKNOWN, parentRoot});
      } else {
        // Parent is known to the fork-choice
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
    relevantBlocks.push(blockInput);
    dataAvailabilityStatuses.push(dataAvailabilityStatus);
    parentSlots.push(parentBlockSlot);
  }

  // Just assert to be over cautious and for purposes to be more explicit for someone
  // going through the code segment
  if (parentBlock === null && relevantBlocks.length > 0) {
    throw Error(`Internal error, parentBlock should not be null for relevantBlocks=${relevantBlocks.length}`);
  }

  return {relevantBlocks, dataAvailabilityStatuses, parentSlots, parentBlock};
}

function maybeValidateBlobs(
  config: ChainForkConfig,
  blockInput: BlockInput,
  opts: ImportBlockOpts
): DataAvailableStatus {
  // TODO Deneb: Make switch verify it's exhaustive
  switch (blockInput.type) {
    case BlockInputType.postDeneb: {
      if (opts.validBlobSidecars) {
        return DataAvailableStatus.available;
      }

      const {block, blobs} = blockInput;
      const blockSlot = block.message.slot;
      const {blobKzgCommitments} = (block as deneb.SignedBeaconBlock).message.body;
      const beaconBlockRoot = config.getForkTypes(blockSlot).BeaconBlock.hashTreeRoot(block.message);
      // TODO Deneb: This function throws un-typed errors
      validateBlobSidecars(blockSlot, beaconBlockRoot, blobKzgCommitments, blobs);

      return DataAvailableStatus.available;
    }

    case BlockInputType.preDeneb:
      return DataAvailableStatus.preDeneb;
  }
}
