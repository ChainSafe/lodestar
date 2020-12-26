import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IBeaconChain, IBlockJob} from "..";
import {IBeaconDb} from "../../db/api";
import {BeaconBlock, ValidatorIndex} from "@chainsafe/lodestar-types";
import {computeStartSlotAtEpoch, EpochContext} from "@chainsafe/lodestar-beacon-state-transition";
import {verifyBlockSignature} from "@chainsafe/lodestar-beacon-state-transition/lib/fast/util";
import {BlockError, BlockErrorCode} from "../errors";

export async function validateGossipBlock(
  config: IBeaconConfig,
  chain: IBeaconChain,
  db: IBeaconDb,
  blockJob: IBlockJob
): Promise<void> {
  const block = blockJob.signedBlock;
  const blockSlot = block.message.slot;
  const blockRoot = config.types.BeaconBlock.hashTreeRoot(block.message);
  const finalizedCheckpoint = await chain.getFinalizedCheckpoint();
  const finalizedSlot = computeStartSlotAtEpoch(config, finalizedCheckpoint.epoch);
  // block is too old
  if (blockSlot <= finalizedSlot) {
    throw new BlockError({
      code: BlockErrorCode.WOULD_REVERT_FINALIZED_SLOT,
      blockSlot,
      finalizedSlot,
      job: blockJob,
    });
  }

  const maxPeerCurrentSlot = chain.clock.maxPeerCurrentSlot;
  if (maxPeerCurrentSlot < blockSlot) {
    throw new BlockError({
      code: BlockErrorCode.FUTURE_SLOT,
      currentSlot: maxPeerCurrentSlot,
      blockSlot,
      job: blockJob,
    });
  }

  if (await db.badBlock.has(blockRoot)) {
    throw new BlockError({
      code: BlockErrorCode.KNOWN_BAD_BLOCK,
      job: blockJob,
    });
  }

  if (await hasProposerAlreadyProposed(db, blockRoot, block.message.proposerIndex)) {
    throw new BlockError({
      code: BlockErrorCode.REPEAT_PROPOSAL,
      proposer: block.message.proposerIndex,
      job: blockJob,
    });
  }

  let blockContext;
  try {
    // getBlockSlotState also checks for whether the current finalized checkpoint is an ancestor of the block.  as a result, we throw an IGNORE (whereas the spec says we should REJECT for this scenario).  this is something we should change this in the future to make the code airtight to the spec.
    blockContext = await chain.regen.getBlockSlotState(block.message.parentRoot, block.message.slot);
  } catch (e) {
    throw new BlockError({
      code: BlockErrorCode.PARENT_UNKNOWN,
      parentRoot: block.message.parentRoot,
      job: blockJob,
    });
  }

  if (!verifyBlockSignature(blockContext.epochCtx, blockContext.state, block)) {
    throw new BlockError({
      code: BlockErrorCode.PROPOSAL_SIGNATURE_INVALID,
      job: blockJob,
    });
  }

  try {
    const validProposer = isExpectedProposer(blockContext.epochCtx, block.message);
    if (!validProposer) {
      throw new BlockError({
        code: BlockErrorCode.INCORRECT_PROPOSER,
        blockProposer: block.message.proposerIndex,
        job: blockJob,
      });
    }
  } catch (error) {
    throw new BlockError({
      code: BlockErrorCode.INCORRECT_PROPOSER,
      blockProposer: block.message.proposerIndex,
      job: blockJob,
    });
  }
}

export async function hasProposerAlreadyProposed(
  db: IBeaconDb,
  blockRoot: Uint8Array,
  proposerIndex: ValidatorIndex
): Promise<boolean> {
  const existingBlock = await db.block.get(blockRoot);
  return existingBlock?.message.proposerIndex === proposerIndex;
}

export function isExpectedProposer(epochCtx: EpochContext, block: BeaconBlock): boolean {
  const supposedProposerIndex = epochCtx.getBeaconProposer(block.slot);
  return supposedProposerIndex === block.proposerIndex;
}
