import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IBeaconChain, IBlockProcessJob} from "../../../chain";
import {IBeaconDb} from "../../../db/api";
import {BeaconBlock, ValidatorIndex} from "@chainsafe/lodestar-types";
import {computeStartSlotAtEpoch, EpochContext} from "@chainsafe/lodestar-beacon-state-transition";
import {ILogger} from "@chainsafe/lodestar-utils";
import {toHexString} from "@chainsafe/ssz";
import {verifyBlockSignature} from "@chainsafe/lodestar-beacon-state-transition/lib/fast/util";
import {BlockError, BlockErrorCode} from "../../../chain/errors";

export async function validateGossipBlock(
  config: IBeaconConfig,
  chain: IBeaconChain,
  db: IBeaconDb,
  logger: ILogger,
  blockJob: IBlockProcessJob
): Promise<void> {
  const block = blockJob.signedBlock;
  const blockSlot = block.message.slot;
  const blockRoot = config.types.BeaconBlock.hashTreeRoot(block.message);
  logger.verbose("Started gossip block validation", {blockSlot, blockRoot: toHexString(blockRoot)});
  const finalizedCheckpoint = await chain.getFinalizedCheckpoint();
  const finalizedSlot = computeStartSlotAtEpoch(config, finalizedCheckpoint.epoch);
  // block is too old
  if (blockSlot <= finalizedSlot) {
    throw new BlockError({
      code: BlockErrorCode.ERR_WOULD_REVERT_FINALIZED_SLOT,
      blockSlot,
      finalizedSlot,
      job: blockJob,
    });
  }

  const currentSlot = chain.clock.currentSlot;
  if (currentSlot < blockSlot) {
    await chain.receiveBlock(block);
    throw new BlockError({
      code: BlockErrorCode.ERR_FUTURE_SLOT,
      blockSlot,
      currentSlot,
      // blockRoot: toHexString(blockRoot),
      job: blockJob,
    });
  }

  if (await db.badBlock.has(blockRoot)) {
    throw new BlockError({
      code: BlockErrorCode.ERR_KNOWN_BAD_BLOCK,
      blockSlot,
      blockRoot,
      job: blockJob,
    });
  }

  if (await hasProposerAlreadyProposed(db, blockRoot, block.message.proposerIndex)) {
    throw new BlockError({
      code: BlockErrorCode.ERR_REPEAT_PROPOSAL,
      slot: blockSlot,
      // blockRoot,
      proposer: block.message.proposerIndex,
      job: blockJob,
    });
  }

  let blockContext;
  try {
    blockContext = await chain.regen.getBlockSlotState(block.message.parentRoot, block.message.slot);
  } catch (e) {
    // temporary skip rest of validation and put in block pool
    // rest of validation is performed in state transition anyways
    await chain.receiveBlock(block);

    throw new BlockError({
      code: BlockErrorCode.ERR_PARENT_UNKNOWN,
      // blockSlot,
      // blockRoot: toHexString(blockRoot),
      parentRoot: block.message.parentRoot,
      job: blockJob,
    });
  }

  if (!verifyBlockSignature(blockContext.epochCtx, blockContext.state, block)) {
    throw new BlockError({
      code: BlockErrorCode.ERR_PROPOSAL_SIGNATURE_INVALID,
      job: blockJob,
      // blockSlot,
      // blockRoot: toHexString(blockRoot),
    });
  }

  if (!isExpectedProposer(blockContext.epochCtx, block.message)) {
    throw new BlockError({
      code: BlockErrorCode.ERR_INCORRECT_PROPOSER,
      blockProposer: block.message.proposerIndex,
      // shufflingProposer,
      // blockSlot,
      // blockRoot: toHexString(blockRoot),
      job: blockJob,
    });
  }
  if (!chain.forkChoice.isDescendantOfFinalized(blockRoot)) {
    throw new BlockError({
      code: BlockErrorCode.ERR_CHECKPOINT_NOT_AN_ANCESTOR_OF_BLOCK,
      job: blockJob,
      blockSlot,
      // blockRoot: toHexString(blockRoot),
    });
  }
  logger.info("Received valid gossip block", {blockSlot, blockRoot: toHexString(blockRoot)});
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
