import {PublicKey} from "@chainsafe/lodestar-z/blst";
import {
  computeEpochAtSlot,
  createSingleSignatureSetFromComponents,
  getExecutionPayloadBidSigningRoot,
  isActiveBuilder,
  isStatePostGloas,
} from "@lodestar/state-transition";
import {gloas} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {ExecutionPayloadBidError, ExecutionPayloadBidErrorCode, GossipAction} from "../errors/index.js";
import {IBeaconChain} from "../index.js";
import {RegenCaller} from "../regen/index.js";

export async function validateApiExecutionPayloadBid(
  chain: IBeaconChain,
  signedExecutionPayloadBid: gloas.SignedExecutionPayloadBid
): Promise<void> {
  return validateExecutionPayloadBid(chain, signedExecutionPayloadBid);
}

export async function validateGossipExecutionPayloadBid(
  chain: IBeaconChain,
  signedExecutionPayloadBid: gloas.SignedExecutionPayloadBid
): Promise<void> {
  return validateExecutionPayloadBid(chain, signedExecutionPayloadBid);
}

async function validateExecutionPayloadBid(
  chain: IBeaconChain,
  signedExecutionPayloadBid: gloas.SignedExecutionPayloadBid
): Promise<void> {
  const bid = signedExecutionPayloadBid.message;
  const parentBlockRootHex = toRootHex(bid.parentBlockRoot);
  const parentBlockHashHex = toRootHex(bid.parentBlockHash);
  const state = await chain.getHeadStateAtCurrentEpoch(RegenCaller.validateGossipExecutionPayloadBid);
  if (!isStatePostGloas(state)) {
    throw new Error(`Expected gloas+ state for execution payload bid validation, got fork=${state.forkName}`);
  }

  // [IGNORE] `bid.slot` is the current slot or the next slot.
  const currentSlot = chain.clock.currentSlot;
  if (bid.slot !== currentSlot && bid.slot !== currentSlot + 1) {
    throw new ExecutionPayloadBidError(GossipAction.IGNORE, {
      code: ExecutionPayloadBidErrorCode.INVALID_SLOT,
      builderIndex: bid.builderIndex,
      slot: bid.slot,
    });
  }

  // [IGNORE] A `SignedProposerPreferences` matching `bid.slot` and the bid's branch has been
  // seen — i.e. `proposal_slot == bid.slot` AND `dependent_root ==
  // get_proposer_dependent_root(parent_state, compute_epoch_at_slot(bid.slot))`,
  // where `parent_state` is the post-state of `bid.parent_block_root`.
  // This is the message referenced as `proposer_preferences` in the following REJECT rules.
  // TODO GLOAS: Implement once a ProposerPreferencesPool exists.

  // [REJECT] `bid.builder_index` is a valid/active builder index -- i.e.
  // `is_active_builder(state, bid.builder_index)` returns `True`.
  const builder = state.getBuilder(bid.builderIndex);
  if (!isActiveBuilder(builder, state.finalizedCheckpoint.epoch)) {
    throw new ExecutionPayloadBidError(GossipAction.REJECT, {
      code: ExecutionPayloadBidErrorCode.BUILDER_NOT_ELIGIBLE,
      builderIndex: bid.builderIndex,
    });
  }

  // [REJECT] `bid.execution_payment` is zero.
  if (bid.executionPayment !== 0) {
    throw new ExecutionPayloadBidError(GossipAction.REJECT, {
      code: ExecutionPayloadBidErrorCode.NON_ZERO_EXECUTION_PAYMENT,
      builderIndex: bid.builderIndex,
      executionPayment: bid.executionPayment,
    });
  }

  // [REJECT] `bid.fee_recipient == proposer_preferences.fee_recipient`.
  // [REJECT] `bid.gas_limit == proposer_preferences.gas_limit`.
  // Both compared against the matching `proposer_preferences` defined above (same branch
  // via dependent_root, same proposal_slot).
  // TODO GLOAS: Implement once a ProposerPreferencesPool exists.

  // [REJECT] The length of KZG commitments is less than or equal to the limitation defined in the
  // consensus layer -- i.e. validate that
  // `len(bid.blob_kzg_commitments) <= get_blob_parameters(compute_epoch_at_slot(bid.slot)).max_blobs_per_block`.
  const blobKzgCommitmentsLen = bid.blobKzgCommitments.length;
  const maxBlobsPerBlock = chain.config.getMaxBlobsPerBlock(computeEpochAtSlot(bid.slot));
  if (blobKzgCommitmentsLen > maxBlobsPerBlock) {
    throw new ExecutionPayloadBidError(GossipAction.REJECT, {
      code: ExecutionPayloadBidErrorCode.TOO_MANY_KZG_COMMITMENTS,
      blobKzgCommitmentsLen,
      commitmentLimit: maxBlobsPerBlock,
    });
  }

  // [IGNORE] this is the first signed bid seen with a valid signature from the given builder for this slot.
  if (chain.seenExecutionPayloadBids.isKnown(bid.slot, bid.builderIndex)) {
    throw new ExecutionPayloadBidError(GossipAction.IGNORE, {
      code: ExecutionPayloadBidErrorCode.BID_ALREADY_KNOWN,
      builderIndex: bid.builderIndex,
      slot: bid.slot,
      parentBlockRoot: parentBlockRootHex,
      parentBlockHash: parentBlockHashHex,
    });
  }

  // [IGNORE] this bid is the highest value bid seen for the tuple
  // `(bid.slot, bid.parent_block_hash, bid.parent_block_root)`.
  const bestBid = chain.executionPayloadBidPool.getBestBid(bid.slot, parentBlockHashHex, parentBlockRootHex);
  if (bestBid !== null && bestBid.value >= bid.value) {
    throw new ExecutionPayloadBidError(GossipAction.IGNORE, {
      code: ExecutionPayloadBidErrorCode.BID_TOO_LOW,
      bidValue: bid.value,
      currentHighestBid: bestBid.value,
    });
  }
  // [IGNORE] `bid.value` is less or equal than the builder's excess balance --
  // i.e. `can_builder_cover_bid(state, builder_index, amount)` returns `True`.
  if (!state.canBuilderCoverBid(bid.builderIndex, bid.value)) {
    throw new ExecutionPayloadBidError(GossipAction.IGNORE, {
      code: ExecutionPayloadBidErrorCode.BID_TOO_HIGH,
      bidValue: bid.value,
      builderBalance: builder.balance,
    });
  }

  // [IGNORE] `bid.parent_block_hash` is the block hash of a known execution
  // payload in fork choice.
  // TODO GLOAS: implement this

  // [IGNORE] `bid.parent_block_root` is the hash tree root of a known beacon
  // block in fork choice.
  if (!chain.forkChoice.hasBlock(bid.parentBlockRoot)) {
    throw new ExecutionPayloadBidError(GossipAction.IGNORE, {
      code: ExecutionPayloadBidErrorCode.UNKNOWN_BLOCK_ROOT,
      parentBlockRoot: parentBlockRootHex,
    });
  }

  // [REJECT] `signed_execution_payload_bid.signature` is valid with respect to the `bid.builder_index`.
  const signatureSet = createSingleSignatureSetFromComponents(
    PublicKey.fromBytes(builder.pubkey),
    getExecutionPayloadBidSigningRoot(chain.config, state.slot, bid),
    signedExecutionPayloadBid.signature
  );

  if (!(await chain.bls.verifySignatureSets([signatureSet]))) {
    throw new ExecutionPayloadBidError(GossipAction.REJECT, {
      code: ExecutionPayloadBidErrorCode.INVALID_SIGNATURE,
      builderIndex: bid.builderIndex,
      slot: bid.slot,
    });
  }

  // Valid
  chain.seenExecutionPayloadBids.add(bid.slot, bid.builderIndex);
}
