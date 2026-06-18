import {ExecutionStatus} from "@lodestar/fork-choice";
import {ForkName, isForkPostBellatrix, isForkPostDeneb, isForkPostGloas} from "@lodestar/params";
import {
  computeEpochAtSlot,
  computeStartSlotAtEpoch,
  computeTimeAtSlot,
  getBlockProposerSignatureSet,
  isExecutionBlockBodyType,
  isStatePostBellatrix,
} from "@lodestar/state-transition";
import {SignedBeaconBlock, deneb, gloas, isGloasBeaconBlock} from "@lodestar/types";
import {byteArrayEquals, sleep, toRootHex} from "@lodestar/utils";
import type {BeaconEngine} from "../beaconEngine/beaconEngine.js";
import {BlockErrorCode, BlockGossipError, GossipAction} from "../errors/index.js";
import {RegenCaller} from "../regen/index.js";

export type GossipBlockValidationResult = {
  /** Number of skipped slots between the block and its parent (blockSlot - parentSlot - 1) */
  skippedSlots: number;
};

export async function validateGossipBlock(
  engine: BeaconEngine,
  signedBlock: SignedBeaconBlock,
  fork: ForkName
): Promise<GossipBlockValidationResult> {
  const config = engine.config;
  const block = signedBlock.message;
  const blockSlot = block.slot;
  const blockEpoch = computeEpochAtSlot(blockSlot);

  // [IGNORE] The block is not from a future slot (with a MAXIMUM_GOSSIP_CLOCK_DISPARITY allowance) -- i.e.validate
  // that signed_beacon_block.message.slot <= current_slot (a client MAY queue future blocks for processing at the
  // appropriate slot).
  const currentSlotWithGossipDisparity = engine.clock.currentSlotWithGossipDisparity;
  if (currentSlotWithGossipDisparity < blockSlot) {
    throw new BlockGossipError(GossipAction.IGNORE, {
      code: BlockErrorCode.FUTURE_SLOT,
      currentSlot: currentSlotWithGossipDisparity,
      blockSlot,
    });
  }

  // [IGNORE] The block is from a slot greater than the latest finalized slot -- i.e. validate that
  // signed_beacon_block.message.slot > compute_start_slot_at_epoch(state.finalized_checkpoint.epoch)
  const finalizedCheckpoint = engine.forkChoice.getFinalizedCheckpoint();
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
  const blockRoot = toRootHex(config.getForkTypes(blockSlot).BeaconBlock.hashTreeRoot(block));
  if (engine.forkChoice.getBlockHexDefaultStatus(blockRoot) !== null) {
    throw new BlockGossipError(GossipAction.IGNORE, {code: BlockErrorCode.ALREADY_KNOWN, root: blockRoot});
  }

  // No need to check for badBlock
  // Gossip de-duplicates messages so we shouldn't be able to receive a bad block twice

  // [IGNORE] The block is the first block with valid signature received for the proposer for the slot, signed_beacon_block.message.slot.
  const proposerIndex = block.proposerIndex;
  if (engine.seenBlockProposers.isKnown(blockSlot, proposerIndex)) {
    throw new BlockGossipError(GossipAction.IGNORE, {code: BlockErrorCode.REPEAT_PROPOSAL, proposerIndex});
  }

  // [REJECT] The current finalized_checkpoint is an ancestor of block -- i.e.
  // get_ancestor(store, block.parent_root, compute_start_slot_at_epoch(store.finalized_checkpoint.epoch)) == store.finalized_checkpoint.root
  const parentRoot = toRootHex(block.parentRoot);
  const parentBlock = engine.forkChoice.getBlockHexDefaultStatus(parentRoot);
  if (parentBlock === null) {
    // If fork choice does *not* consider the parent to be a descendant of the finalized block,
    // then there are two more cases:
    //
    // 1. We have the parent stored in our database. Because fork-choice has confirmed the
    //    parent is *not* in our post-finalization DAG, all other blocks must be either
    //    pre-finalization or conflicting with finalization.
    // 2. The parent is unknown to us, we probably want to download it since it might actually
    //    descend from the finalized root.
    // (Non-Lighthouse): Since we prune all blocks non-descendant from finalized checking the `db.block` database won't be useful to guard
    // against known bad fork blocks, so we throw PARENT_UNKNOWN for cases (1) and (2)
    throw new BlockGossipError(GossipAction.IGNORE, {code: BlockErrorCode.PARENT_UNKNOWN, parentRoot});
  }

  // [IGNORE] The block's parent (defined by `block.parent_root`) passes all validation
  // (including execution node verification of the `block.body.execution_payload`)
  if (isForkPostBellatrix(fork) && parentBlock.executionStatus === ExecutionStatus.Invalid) {
    throw new BlockGossipError(GossipAction.IGNORE, {
      code: BlockErrorCode.PARENT_EXECUTION_INVALID,
      parentRoot,
    });
  }

  // [IGNORE] The block's parent execution payload (defined by bid.parent_block_hash) has been seen
  // (via gossip or non-gossip sources) (a client MAY queue blocks for processing once the parent payload is retrieved).
  if (isGloasBeaconBlock(block)) {
    const parentBlockHashHex = toRootHex(block.body.signedExecutionPayloadBid.message.parentBlockHash);
    if (engine.forkChoice.getBlockHexAndBlockHash(parentRoot, parentBlockHashHex) === null) {
      throw new BlockGossipError(GossipAction.IGNORE, {
        code: BlockErrorCode.PARENT_PAYLOAD_UNKNOWN,
        parentRoot,
        parentBlockHash: parentBlockHashHex,
      });
    }
  }

  // [REJECT] The block is from a higher slot than its parent.
  if (parentBlock.slot >= blockSlot) {
    throw new BlockGossipError(GossipAction.REJECT, {
      code: BlockErrorCode.NOT_LATER_THAN_PARENT,
      parentSlot: parentBlock.slot,
      slot: blockSlot,
    });
  }

  // Number of skipped slots between block and parent (non-spec). Previously this gated blocks via
  // maxSkipSlots; now the caller only observes it so legitimate post-skip blocks are no longer ignored.
  const skippedSlots = blockSlot - parentBlock.slot - 1;

  // [REJECT] The length of KZG commitments is less than or equal to the limitation defined in Consensus Layer -- i.e. validate that len(body.signed_beacon_block.message.blob_kzg_commitments) <= MAX_BLOBS_PER_BLOCK
  if (isForkPostDeneb(fork) && !isForkPostGloas(fork)) {
    const blobKzgCommitmentsLen = (block as deneb.BeaconBlock).body.blobKzgCommitments.length;
    const maxBlobsPerBlock = config.getMaxBlobsPerBlock(blockEpoch);
    if (blobKzgCommitmentsLen > maxBlobsPerBlock) {
      throw new BlockGossipError(GossipAction.REJECT, {
        code: BlockErrorCode.TOO_MANY_KZG_COMMITMENTS,
        blobKzgCommitmentsLen,
        commitmentLimit: maxBlobsPerBlock,
      });
    }
  }

  if (isForkPostGloas(fork)) {
    const bid = (block as gloas.BeaconBlock).body.signedExecutionPayloadBid.message;

    // [REJECT] The length of KZG commitments is less than or equal to the limitation defined in Consensus Layer
    // -- i.e. validate that len(bid.blob_kzg_commitments) <= max_blobs_per_block
    const blobKzgCommitmentsLen = bid.blobKzgCommitments.length;
    const maxBlobsPerBlock = config.getMaxBlobsPerBlock(blockEpoch);
    if (blobKzgCommitmentsLen > maxBlobsPerBlock) {
      throw new BlockGossipError(GossipAction.REJECT, {
        code: BlockErrorCode.TOO_MANY_KZG_COMMITMENTS,
        blobKzgCommitmentsLen,
        commitmentLimit: maxBlobsPerBlock,
      });
    }

    // [REJECT] The bid's parent (defined by bid.parent_block_root) equals the block's parent (defined by block.parent_root)
    if (!byteArrayEquals(bid.parentBlockRoot, block.parentRoot)) {
      throw new BlockGossipError(GossipAction.REJECT, {
        code: BlockErrorCode.BID_PARENT_ROOT_MISMATCH,
        bidParentRoot: toRootHex(bid.parentBlockRoot),
        blockParentRoot: parentRoot,
      });
    }

    // TODO GLOAS: [REJECT] The block's execution payload parent (defined by bid.parent_block_hash) passes all validation
    // This requires execution engine integration to verify the parent block hash
  }

  // use getPreState to reload state if needed. It also checks for whether the current finalized checkpoint is an ancestor of the block.
  // As a result, we throw an IGNORE (whereas the spec says we should REJECT for this scenario).
  // this is something we should change this in the future to make the code airtight to the spec.
  // [IGNORE] The block's parent (defined by block.parent_root) has been seen (via both gossip and non-gossip sources) (a client MAY queue blocks for processing once the parent block is retrieved).
  // [REJECT] The block's parent (defined by block.parent_root) passes validation.
  const blockState = await engine.regen
    .getPreState(block, {dontTransferCache: true}, RegenCaller.validateGossipBlock)
    .catch(() => {
      throw new BlockGossipError(GossipAction.IGNORE, {code: BlockErrorCode.PARENT_UNKNOWN, parentRoot});
    });

  // in forky condition, make sure to populate ShufflingCache with regened state
  engine.shufflingCache.processState(blockState);

  // [REJECT] The block's execution payload timestamp is correct with respect to the slot
  // -- i.e. execution_payload.timestamp == compute_timestamp_at_slot(state, block.slot).
  if (isForkPostBellatrix(fork) && !isForkPostGloas(fork)) {
    if (!isExecutionBlockBodyType(block.body)) throw Error("Not execution block body type");
    const executionPayload = block.body.executionPayload;
    if (isStatePostBellatrix(blockState) && blockState.isExecutionStateType && blockState.isExecutionEnabled(block)) {
      const expectedTimestamp = computeTimeAtSlot(config, blockSlot, engine.clock.genesisTime);
      if (executionPayload.timestamp !== computeTimeAtSlot(config, blockSlot, engine.clock.genesisTime)) {
        throw new BlockGossipError(GossipAction.REJECT, {
          code: BlockErrorCode.INCORRECT_TIMESTAMP,
          timestamp: executionPayload.timestamp,
          expectedTimestamp,
        });
      }
    }
  }

  // [REJECT] The proposer index is a valid validator index
  if (proposerIndex >= blockState.validatorCount) {
    throw new BlockGossipError(GossipAction.REJECT, {code: BlockErrorCode.UNKNOWN_PROPOSER, proposerIndex});
  }

  // [REJECT] The proposer signature, signed_beacon_block.signature, is valid with respect to the proposer_index pubkey.
  if (!engine.seenBlockInputCache.isVerifiedProposerSignature(blockSlot, blockRoot, signedBlock.signature)) {
    const signatureSet = getBlockProposerSignatureSet(engine.config, signedBlock);
    // Don't batch so verification is not delayed
    if (!(await engine.bls.verifySignatureSets([signatureSet], {verifyOnMainThread: true}))) {
      throw new BlockGossipError(GossipAction.REJECT, {
        code: BlockErrorCode.PROPOSAL_SIGNATURE_INVALID,
        blockSlot,
      });
    }

    engine.seenBlockInputCache.markVerifiedProposerSignature(blockSlot, blockRoot, signedBlock.signature);
  }

  // [REJECT] The block is proposed by the expected proposer_index for the block's slot in the context of the current
  // shuffling (defined by parent_root/slot). If the proposer_index cannot immediately be verified against the expected
  // shuffling, the block MAY be queued for later processing while proposers for the block's branch are calculated --
  // in such a case do not REJECT, instead IGNORE this message.
  if (blockState.getBeaconProposer(blockSlot) !== proposerIndex) {
    throw new BlockGossipError(GossipAction.REJECT, {code: BlockErrorCode.INCORRECT_PROPOSER, proposerIndex});
  }

  // Check again in case there two blocks are processed concurrently
  if (engine.seenBlockProposers.isKnown(blockSlot, proposerIndex)) {
    throw new BlockGossipError(GossipAction.IGNORE, {code: BlockErrorCode.REPEAT_PROPOSAL, proposerIndex});
  }

  // Simple implementation of a pending block queue. Keeping the block here recycles the queue logic, and keeps the
  // gossip validation promise without any extra infrastructure.
  // Do the sleep at the end, since regen and signature validation can already take longer than `msToBlockSlot`.
  const msToBlockSlot = computeTimeAtSlot(config, blockSlot, engine.clock.genesisTime) * 1000 - Date.now();
  if (msToBlockSlot <= config.MAXIMUM_GOSSIP_CLOCK_DISPARITY && msToBlockSlot > 0) {
    // If block is between 0 and 500 ms early, hold it in a promise. Equivalent to a pending queue.
    await sleep(msToBlockSlot);
  }

  engine.seenBlockProposers.add(blockSlot, proposerIndex);

  return {skippedSlots};
}
