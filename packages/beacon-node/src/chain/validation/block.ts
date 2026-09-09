import {ChainForkConfig} from "@lodestar/config";
import {ExecutionStatus} from "@lodestar/fork-choice";
import {
  ForkName,
  MAX_ATTESTATIONS_ELECTRA,
  MAX_ATTESTER_SLASHINGS_ELECTRA,
  MAX_BLS_TO_EXECUTION_CHANGES,
  MAX_BUILDER_DEPOSIT_REQUESTS_PER_PAYLOAD,
  MAX_BUILDER_EXIT_REQUESTS_PER_PAYLOAD,
  MAX_CONSOLIDATION_REQUESTS_PER_PAYLOAD,
  MAX_PAYLOAD_ATTESTATIONS,
  MAX_PROPOSER_SLASHINGS,
  MAX_VOLUNTARY_EXITS,
  MAX_WITHDRAWAL_REQUESTS_PER_PAYLOAD,
  MIN_SEED_LOOKAHEAD,
  isForkPostBellatrix,
  isForkPostDeneb,
  isForkPostGloas,
} from "@lodestar/params";
import {
  computeEpochAtSlot,
  computeStartSlotAtEpoch,
  computeTimeAtSlot,
  getBlockProposerSignatureSet,
  isExecutionBlockBodyType,
  isStatePostBellatrix,
  signedBlockToSignedHeader,
} from "@lodestar/state-transition";
import {RootHex, SignedBeaconBlock, deneb, gloas, isGloasBeaconBlock, ssz} from "@lodestar/types";
import {byteArrayEquals, sleep, toRootHex} from "@lodestar/utils";
import {BlockErrorCode, BlockGossipError, GossipAction} from "../errors/index.js";
import {IBeaconChain} from "../interface.js";
import {RegenCaller} from "../regen/index.js";

export type GossipBlockValidationResult = {
  /** Number of skipped slots between the block and its parent (blockSlot - parentSlot - 1) */
  skippedSlots: number;
};

export async function validateGossipBlock(
  config: ChainForkConfig,
  chain: IBeaconChain,
  signedBlock: SignedBeaconBlock,
  fork: ForkName
): Promise<GossipBlockValidationResult> {
  const block = signedBlock.message;
  const blockSlot = block.slot;
  const blockEpoch = computeEpochAtSlot(blockSlot);

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
  const finalizedCheckpoint = chain.forkChoice.getFinalizedCheckpoint();
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
  // A block's hash tree root is identical to its header's, so the root is derived from the header
  // which is also used as potential equivocation evidence
  const signedBlockHeader = signedBlockToSignedHeader(config, signedBlock);
  const blockRoot = toRootHex(ssz.phase0.BeaconBlockHeader.hashTreeRoot(signedBlockHeader.message));
  if (chain.forkChoice.getBlockHexDefaultStatus(blockRoot) !== null) {
    throw new BlockGossipError(GossipAction.IGNORE, {code: BlockErrorCode.ALREADY_KNOWN, root: blockRoot});
  }

  // No need to check for badBlock
  // Gossip de-duplicates messages so we shouldn't be able to receive a bad block twice

  // [IGNORE] The block is the first block with valid signature received for the proposer for the slot, signed_beacon_block.message.slot.
  const proposerIndex = block.proposerIndex;
  if (chain.seenBlockProposers.isKnown(blockSlot, proposerIndex)) {
    if (chain.seenBlockProposers.isRepeatProposal(blockSlot, proposerIndex, blockRoot)) {
      const hasBlockRoot = chain.seenBlockProposers.hasBlockRoot(blockSlot, proposerIndex, blockRoot);
      if (!hasBlockRoot && !chain.seenBlockProposers.isEquivocating(blockSlot, proposerIndex)) {
        await verifyBlockProposerSignature(chain, signedBlock, blockRoot, {verifyOnMainThread: false});
        chain.seenBlockProposers.observeBlockRoot(blockSlot, proposerIndex, blockRoot, signedBlockHeader);
      }
      throw new BlockGossipError(GossipAction.IGNORE, {
        code: BlockErrorCode.REPEAT_PROPOSAL,
        proposerIndex,
        root: blockRoot,
      });
    }
    throw new BlockGossipError(GossipAction.IGNORE, {code: BlockErrorCode.ALREADY_KNOWN, root: blockRoot});
  }

  // [REJECT] The current finalized_checkpoint is an ancestor of block -- i.e.
  // get_ancestor(store, block.parent_root, compute_start_slot_at_epoch(store.finalized_checkpoint.epoch)) == store.finalized_checkpoint.root
  const parentRoot = toRootHex(block.parentRoot);
  const parentBlock = chain.forkChoice.getBlockHexDefaultStatus(parentRoot);
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
    // against known bad fork blocks, so we throw PARENT_BLOCK_UNKNOWN for cases (1) and (2)
    throw new BlockGossipError(GossipAction.IGNORE, {code: BlockErrorCode.PARENT_BLOCK_UNKNOWN, parentRoot});
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
    if (chain.forkChoice.getBlockHexAndBlockHash(parentRoot, parentBlockHashHex) === null) {
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

    // [REJECT] The counts of `block.body.parent_execution_requests` are within
    //   their respective limits -- i.e. validate that
    //   `len(block.body.parent_execution_requests.withdrawals) <= MAX_WITHDRAWAL_REQUESTS_PER_PAYLOAD`,
    //   `len(block.body.parent_execution_requests.consolidations) <= MAX_CONSOLIDATION_REQUESTS_PER_PAYLOAD`,
    //   `len(block.body.parent_execution_requests.builder_deposits) <= MAX_BUILDER_DEPOSIT_REQUESTS_PER_PAYLOAD`,
    //   and
    //   `len(block.body.parent_execution_requests.builder_exits) <= MAX_BUILDER_EXIT_REQUESTS_PER_PAYLOAD`.
    // [REJECT] The counts of the block body operations are within their respective
    //   limits -- i.e. validate that
    //   `len(block.body.proposer_slashings) <= MAX_PROPOSER_SLASHINGS`,
    //   `len(block.body.attester_slashings) <= MAX_ATTESTER_SLASHINGS_ELECTRA`,
    //   `len(block.body.attestations) <= MAX_ATTESTATIONS_ELECTRA`,
    //   `len(block.body.deposits) == 0`,
    //   `len(block.body.voluntary_exits) <= MAX_VOLUNTARY_EXITS`,
    //   `len(block.body.bls_to_execution_changes) <= MAX_BLS_TO_EXECUTION_CHANGES`,
    //   and `len(block.body.payload_attestations) <= MAX_PAYLOAD_ATTESTATIONS`.
    const body = (block as gloas.BeaconBlock).body;
    const requests = body.parentExecutionRequests;
    const countLimits: [string, number, number][] = [
      ["parentExecutionRequests.withdrawals", requests.withdrawals.length, MAX_WITHDRAWAL_REQUESTS_PER_PAYLOAD],
      [
        "parentExecutionRequests.consolidations",
        requests.consolidations.length,
        MAX_CONSOLIDATION_REQUESTS_PER_PAYLOAD,
      ],
      [
        "parentExecutionRequests.builderDeposits",
        requests.builderDeposits.length,
        MAX_BUILDER_DEPOSIT_REQUESTS_PER_PAYLOAD,
      ],
      ["parentExecutionRequests.builderExits", requests.builderExits.length, MAX_BUILDER_EXIT_REQUESTS_PER_PAYLOAD],
      ["proposerSlashings", body.proposerSlashings.length, MAX_PROPOSER_SLASHINGS],
      ["attesterSlashings", body.attesterSlashings.length, MAX_ATTESTER_SLASHINGS_ELECTRA],
      ["attestations", body.attestations.length, MAX_ATTESTATIONS_ELECTRA],
      ["deposits", body.deposits.length, 0],
      ["voluntaryExits", body.voluntaryExits.length, MAX_VOLUNTARY_EXITS],
      ["blsToExecutionChanges", body.blsToExecutionChanges.length, MAX_BLS_TO_EXECUTION_CHANGES],
      ["payloadAttestations", body.payloadAttestations.length, MAX_PAYLOAD_ATTESTATIONS],
    ];
    for (const [name, count, limit] of countLimits) {
      if (count > limit) {
        throw new BlockGossipError(GossipAction.REJECT, {
          code: BlockErrorCode.TOO_MANY_BLOCK_OPERATIONS,
          name,
          count,
          limit,
        });
      }
    }

    // TODO GLOAS: [REJECT] The block's execution payload parent (defined by bid.parent_block_hash) passes all validation
    // This requires execution engine integration to verify the parent block hash
  }

  // For gossip forwarding we only need the state to check the block's proposer index.
  // If the state cannot be regenerated we throw an IGNORE (whereas the spec says we should REJECT for the
  // finalized-ancestor scenario, which is already guarded by the parentBlock lookup above).
  // this is something we should change this in the future to make the code airtight to the spec.
  // [IGNORE] The block's parent (defined by block.parent_root) has been seen (via both gossip and non-gossip sources) (a client MAY queue blocks for processing once the parent block is retrieved).
  // [REJECT] The block's parent (defined by block.parent_root) passes validation.
  const canUseParentState = blockEpoch - computeEpochAtSlot(parentBlock.slot) <= MIN_SEED_LOOKAHEAD;

  const getValidationState = async () => {
    const getPreState = () =>
      chain.regen.getPreState(block, {dontTransferCache: true}, RegenCaller.validateGossipBlock);
    if (canUseParentState) {
      try {
        const parentState = await chain.regen.getState(parentBlock.stateRoot, RegenCaller.validateGossipBlock);
        chain.metrics?.gossipBlock.preStateSource.inc({source: "parentState"});
        return parentState;
      } catch {
        // if parent state is not in memory, we fall back to disk reload / dial-forward
        chain.metrics?.gossipBlock.preStateSource.inc({source: "fallbackPreState"});
        chain.logger.debug("Parent state not in memory, falling back to getPreState for gossip block validation", {
          slot: blockSlot,
          root: blockRoot,
          parentSlot: parentBlock.slot,
          parentRoot,
        });
        return getPreState();
      }
    }
    // parent is >1 epoch behind (deep skip) → beyond proposer-lookahead range, must dial forward
    chain.metrics?.gossipBlock.preStateSource.inc({source: "preState"});
    chain.logger.debug("Cannot use parent state for gossip block validation, dialing forward via getPreState", {
      slot: blockSlot,
      root: blockRoot,
      parentSlot: parentBlock.slot,
      parentRoot,
    });
    return getPreState();
  };

  const state = await getValidationState().catch(() => {
    throw new BlockGossipError(GossipAction.IGNORE, {code: BlockErrorCode.PARENT_BLOCK_UNKNOWN, parentRoot});
  });

  // in forky condition, make sure to populate ShufflingCache with regened state
  chain.shufflingCache.processState(state);

  // [REJECT] The block's execution payload timestamp is correct with respect to the slot
  // -- i.e. execution_payload.timestamp == compute_timestamp_at_slot(state, block.slot).
  if (isForkPostBellatrix(fork) && !isForkPostGloas(fork)) {
    if (!isExecutionBlockBodyType(block.body)) throw Error("Not execution block body type");
    const executionPayload = block.body.executionPayload;
    if (isStatePostBellatrix(state) && state.isExecutionStateType && state.isExecutionEnabled(block)) {
      const expectedTimestamp = computeTimeAtSlot(config, blockSlot, chain.genesisTime);
      if (executionPayload.timestamp !== computeTimeAtSlot(config, blockSlot, chain.genesisTime)) {
        throw new BlockGossipError(GossipAction.REJECT, {
          code: BlockErrorCode.INCORRECT_TIMESTAMP,
          timestamp: executionPayload.timestamp,
          expectedTimestamp,
        });
      }
    }
  }

  // [REJECT] The proposer index is a valid validator index
  if (proposerIndex >= state.validatorCount) {
    throw new BlockGossipError(GossipAction.REJECT, {code: BlockErrorCode.UNKNOWN_PROPOSER, proposerIndex});
  }

  // [REJECT] The proposer signature, signed_beacon_block.signature, is valid with respect to the proposer_index pubkey.
  await verifyBlockProposerSignature(chain, signedBlock, blockRoot);
  chain.seenBlockProposers.observeBlockRoot(blockSlot, proposerIndex, blockRoot, signedBlockHeader);

  // [REJECT] The block is proposed by the expected proposer_index for the block's slot in the context of the current
  // shuffling (defined by parent_root/slot). If the proposer_index cannot immediately be verified against the expected
  // shuffling, the block MAY be queued for later processing while proposers for the block's branch are calculated --
  // in such a case do not REJECT, instead IGNORE this message.
  if (state.getBeaconProposer(blockSlot) !== proposerIndex) {
    throw new BlockGossipError(GossipAction.REJECT, {code: BlockErrorCode.INCORRECT_PROPOSER, proposerIndex});
  }

  // Simple implementation of a pending block queue. Keeping the block here recycles the queue logic, and keeps the
  // gossip validation promise without any extra infrastructure.
  // Do the sleep at the end, since regen and signature validation can already take longer than `msToBlockSlot`.
  const msToBlockSlot = computeTimeAtSlot(config, blockSlot, chain.genesisTime) * 1000 - Date.now();
  if (msToBlockSlot <= config.MAXIMUM_GOSSIP_CLOCK_DISPARITY && msToBlockSlot > 0) {
    // If block is between 0 and 500 ms early, hold it in a promise. Equivalent to a pending queue.
    await sleep(msToBlockSlot);
  }

  // Check again after all async validation and the early-block delay so concurrent proposals cannot both pass
  if (chain.seenBlockProposers.isKnown(blockSlot, proposerIndex)) {
    if (chain.seenBlockProposers.isRepeatProposal(blockSlot, proposerIndex, blockRoot)) {
      throw new BlockGossipError(GossipAction.IGNORE, {
        code: BlockErrorCode.REPEAT_PROPOSAL,
        proposerIndex,
        root: blockRoot,
      });
    }
    throw new BlockGossipError(GossipAction.IGNORE, {code: BlockErrorCode.ALREADY_KNOWN, root: blockRoot});
  }

  chain.seenBlockProposers.add(blockSlot, proposerIndex, blockRoot);

  return {skippedSlots};
}

export async function verifyBlockProposerSignature(
  chain: IBeaconChain,
  signedBlock: SignedBeaconBlock,
  blockRoot: RootHex,
  opts: {verifyOnMainThread?: boolean} = {}
): Promise<void> {
  const blockSlot = signedBlock.message.slot;
  if (chain.seenBlockInputCache.isVerifiedProposerSignature(blockSlot, blockRoot, signedBlock.signature)) {
    return;
  }

  const signatureSet = getBlockProposerSignatureSet(chain.config, signedBlock);
  // Don't batch so verification is not delayed
  if (!(await chain.bls.verifySignatureSets([signatureSet], {verifyOnMainThread: opts.verifyOnMainThread ?? true}))) {
    throw new BlockGossipError(GossipAction.REJECT, {
      code: BlockErrorCode.PROPOSAL_SIGNATURE_INVALID,
      blockSlot,
    });
  }

  chain.seenBlockInputCache.markVerifiedProposerSignature(blockSlot, blockRoot, signedBlock.signature);
}
