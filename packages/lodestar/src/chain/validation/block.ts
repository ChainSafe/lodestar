import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {IBeaconChain, IBlockJob} from "..";
import {IBeaconDb} from "../../db";
import {computeStartSlotAtEpoch} from "@chainsafe/lodestar-beacon-state-transition";
import {allForks} from "@chainsafe/lodestar-beacon-state-transition";
import {BlockGossipError, BlockErrorCode, GossipAction} from "../errors";
import {RegenCaller} from "../regen";

export async function validateGossipBlock(
  config: IChainForkConfig,
  chain: IBeaconChain,
  db: IBeaconDb,
  blockJob: IBlockJob
): Promise<void> {
  const signedBlock = blockJob.signedBlock;
  const block = signedBlock.message;
  const blockSlot = block.slot;

  // [IGNORE] The block is not from a future slot (with a MAXIMUM_GOSSIP_CLOCK_DISPARITY allowance) -- i.e.validate
  // that signed_beacon_block.message.slot <= current_slot (a client MAY queue future blocks for processing at the
  // appropriate slot).
  const currentSlotWithGossipDisparity = chain.clock.currentSlotWithGossipDisparity;
  if (currentSlotWithGossipDisparity < blockSlot) {
    throw new BlockGossipError(GossipAction.IGNORE, {
      code: BlockErrorCode.FUTURE_SLOT,
      currentSlot: currentSlotWithGossipDisparity,
      blockSlot,
    });
  }

  // [IGNORE] The block is from a slot greater than the latest finalized slot -- i.e. validate that
  // signed_beacon_block.message.slot > compute_start_slot_at_epoch(state.finalized_checkpoint.epoch)
  const finalizedCheckpoint = chain.getFinalizedCheckpoint();
  const finalizedSlot = computeStartSlotAtEpoch(finalizedCheckpoint.epoch);
  if (blockSlot <= finalizedSlot) {
    throw new BlockGossipError(GossipAction.IGNORE, {
      code: BlockErrorCode.WOULD_REVERT_FINALIZED_SLOT,
      blockSlot,
      finalizedSlot,
    });
  }

  // Check if the block is already known. We know it is post-finalization, so it is sufficient to check the fork choice.
  //
  // In normal operation this isn't necessary, however it is useful immediately after a
  // reboot if the `observed_block_producers` cache is empty. In that case, without this
  // check, we will load the parent and state from disk only to find out later that we
  // already know this block.
  const blockRoot = config.getForkTypes(block.slot).BeaconBlock.hashTreeRoot(block);
  if (chain.forkChoice.getBlock(blockRoot) !== null) {
    throw new BlockGossipError(GossipAction.IGNORE, {code: BlockErrorCode.ALREADY_KNOWN, root: blockRoot});
  }

  // No need to check for badBlock
  // Gossip de-duplicates messages so we shouldn't be able to receive a bad block twice

  // [IGNORE] The block is the first block with valid signature received for the proposer for the slot, signed_beacon_block.message.slot.
  const proposerIndex = block.proposerIndex;
  if (chain.seenBlockProposers.isKnown(blockSlot, proposerIndex)) {
    throw new BlockGossipError(GossipAction.IGNORE, {code: BlockErrorCode.REPEAT_PROPOSAL, proposerIndex});
  }

  // [REJECT] The current finalized_checkpoint is an ancestor of block -- i.e.
  // get_ancestor(store, block.parent_root, compute_start_slot_at_epoch(store.finalized_checkpoint.epoch)) == store.finalized_checkpoint.root
  const parentRoot = block.parentRoot.valueOf() as Uint8Array;
  const parentBlock = chain.forkChoice.getBlock(parentRoot);
  if (parentBlock === null) {
    // If fork choice does *not* consider the parent to be a descendant of the finalized block,
    // then there are two more cases:
    //
    // 1. We have the parent stored in our database. Because fork-choice has confirmed the
    //    parent is *not* in our post-finalization DAG, all other blocks must be either
    //    pre-finalization or conflicting with finalization.
    // 2. The parent is unknown to us, we probably want to download it since it might actually
    //    descend from the finalized root.
    if ((await db.block.get(parentRoot as Uint8Array)) !== null) {
      throw new BlockGossipError(GossipAction.REJECT, {code: BlockErrorCode.NOT_FINALIZED_DESCENDANT, parentRoot});
    } else {
      throw new BlockGossipError(GossipAction.IGNORE, {code: BlockErrorCode.PARENT_UNKNOWN, parentRoot});
    }
  }

  // [REJECT] The block is from a higher slot than its parent.
  if (parentBlock.slot >= blockSlot) {
    throw new BlockGossipError(GossipAction.IGNORE, {
      code: BlockErrorCode.NOT_LATER_THAN_PARENT,
      parentSlot: parentBlock.slot,
      slot: blockSlot,
    });
  }

  // getBlockSlotState also checks for whether the current finalized checkpoint is an ancestor of the block.
  // As a result, we throw an IGNORE (whereas the spec says we should REJECT for this scenario).
  // this is something we should change this in the future to make the code airtight to the spec.
  // [IGNORE] The block's parent (defined by block.parent_root) has been seen (via both gossip and non-gossip sources) (a client MAY queue blocks for processing once the parent block is retrieved).
  // [REJECT] The block's parent (defined by block.parent_root) passes validation.
  const blockState = await chain.regen
    .getBlockSlotState(parentRoot, block.slot, RegenCaller.validateGossipBlock)
    .catch(() => {
      throw new BlockGossipError(GossipAction.IGNORE, {code: BlockErrorCode.PARENT_UNKNOWN, parentRoot});
    });

  // [REJECT] The proposer signature, signed_beacon_block.signature, is valid with respect to the proposer_index pubkey.
  const signatureSet = allForks.getProposerSignatureSet(blockState, signedBlock);
  // Don't batch so verification is not delayed
  if (!(await chain.bls.verifySignatureSets([signatureSet]))) {
    throw new BlockGossipError(GossipAction.REJECT, {code: BlockErrorCode.PROPOSAL_SIGNATURE_INVALID});
  }

  // [REJECT] The block is proposed by the expected proposer_index for the block's slot in the context of the current
  // shuffling (defined by parent_root/slot). If the proposer_index cannot immediately be verified against the expected
  // shuffling, the block MAY be queued for later processing while proposers for the block's branch are calculated --
  // in such a case do not REJECT, instead IGNORE this message.
  if (blockState.epochCtx.getBeaconProposer(block.slot) !== block.proposerIndex) {
    throw new BlockGossipError(GossipAction.REJECT, {code: BlockErrorCode.INCORRECT_PROPOSER, proposerIndex});
  }

  // Check again in case there two blocks are processed concurrently
  if (chain.seenBlockProposers.isKnown(blockSlot, proposerIndex)) {
    throw new BlockGossipError(GossipAction.IGNORE, {code: BlockErrorCode.REPEAT_PROPOSAL, proposerIndex});
  }

  chain.seenBlockProposers.add(blockSlot, proposerIndex);
}
