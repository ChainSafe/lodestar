import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {computeStartSlotAtEpoch} from "@chainsafe/lodestar-beacon-state-transition";
import {allForks} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconChain, IBlockJob} from "..";
import {IBeaconDb} from "../../db";
import {BlockGossipError, BlockErrorCode, GossipAction} from "../errors";

export async function validateGossipBlock(
  config: IBeaconConfig,
  chain: IBeaconChain,
  db: IBeaconDb,
  blockJob: IBlockJob
): Promise<void> {
  const block = blockJob.signedBlock;
  const blockSlot = block.message.slot;
  const blockRoot = config.getForkTypes(block.message.slot).BeaconBlock.hashTreeRoot(block.message);

  // getBlockSlotState also checks for whether the current finalized checkpoint is an ancestor of the block.
  // As a result, we throw an IGNORE (whereas the spec says we should REJECT for this scenario).
  // this is something we should change this in the future to make the code airtight to the spec.
  const blockState = await chain.regen.getBlockSlotState(block.message.parentRoot, block.message.slot).catch(() => {
    throw new BlockGossipError(GossipAction.IGNORE, {
      code: BlockErrorCode.PARENT_UNKNOWN,
      parentRoot: block.message.parentRoot.valueOf() as Uint8Array,
      job: blockJob,
    });
  });

  // [IGNORE] The block is not from a future slot (with a MAXIMUM_GOSSIP_CLOCK_DISPARITY allowance)
  // -- i.e. validate that signed_beacon_block.message.slot <= current_slot (a client MAY queue future blocks for processing at the appropriate slot).
  const currentSlotWithGossipDisparity = chain.clock.currentSlotWithGossipDisparity;
  if (currentSlotWithGossipDisparity < blockSlot) {
    throw new BlockGossipError(GossipAction.IGNORE, {
      code: BlockErrorCode.FUTURE_SLOT,
      currentSlot: currentSlotWithGossipDisparity,
      blockSlot,
      job: blockJob,
    });
  }

  // [IGNORE] The block is from a slot greater than the latest finalized slot
  // -- i.e. validate that signed_beacon_block.message.slot > compute_start_slot_at_epoch(state.finalized_checkpoint.epoch)
  // (a client MAY choose to validate and store such blocks for additional purposes -- e.g. slashing detection, archive nodes, etc).
  const finalizedCheckpoint = chain.getFinalizedCheckpoint();
  const finalizedSlot = computeStartSlotAtEpoch(config, finalizedCheckpoint.epoch);
  if (blockSlot <= finalizedSlot) {
    throw new BlockGossipError(GossipAction.IGNORE, {
      code: BlockErrorCode.WOULD_REVERT_FINALIZED_SLOT,
      blockSlot,
      finalizedSlot,
      job: blockJob,
    });
  }

  // [IGNORE] The block is the first block with valid signature received for the proposer for the slot, signed_beacon_block.message.slot.
  const existingBlock = await db.block.get(blockRoot);
  if (existingBlock?.message.proposerIndex === block.message.proposerIndex) {
    throw new BlockGossipError(GossipAction.IGNORE, {
      code: BlockErrorCode.REPEAT_PROPOSAL,
      proposer: block.message.proposerIndex,
      job: blockJob,
    });
  }

  // [IGNORE] The block's parent (defined by block.parent_root) has been seen (via both gossip and non-gossip sources)
  // (a client MAY queue blocks for processing once the parent block is retrieved).

  // [REJECT] The block's parent (defined by block.parent_root) passes validation.

  // [REJECT] The block is from a higher slot than its parent.

  // [REJECT] The current finalized_checkpoint is an ancestor of block
  // -- i.e. get_ancestor(store, block.parent_root, compute_start_slot_at_epoch(store.finalized_checkpoint.epoch)) == store.finalized_checkpoint.root

  // [REJECT] The block is proposed by the expected proposer_index for the block's slot in the context of
  // the current shuffling (defined by parent_root/slot). If the proposer_index cannot immediately be verified
  // against the expected shuffling, the block MAY be queued for later processing while proposers for the
  // block's branch are calculated -- in such a case do not REJECT, instead IGNORE this message.
  try {
    if (blockState.epochCtx.getBeaconProposer(block.message.slot) !== block.message.proposerIndex) {
      throw new Error("INCORRECT_PROPOSER");
    }
  } catch (error) {
    throw new BlockGossipError(GossipAction.REJECT, {
      code: BlockErrorCode.INCORRECT_PROPOSER,
      blockProposer: block.message.proposerIndex,
      job: blockJob,
    });
  }

  if (await db.badBlock.has(blockRoot)) {
    throw new BlockGossipError(GossipAction.REJECT, {
      code: BlockErrorCode.KNOWN_BAD_BLOCK,
      job: blockJob,
    });
  }

  // [REJECT] The proposer signature, signed_beacon_block.signature, is valid with respect to the proposer_index pubkey.
  const signatureSet = allForks.getProposerSignatureSet(blockState, block);
  if (!(await chain.bls.verifySignatureSets([signatureSet]))) {
    throw new BlockGossipError(GossipAction.REJECT, {
      code: BlockErrorCode.PROPOSAL_SIGNATURE_INVALID,
      job: blockJob,
    });
  }
}
