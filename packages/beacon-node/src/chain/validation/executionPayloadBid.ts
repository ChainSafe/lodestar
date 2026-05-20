import {PublicKey} from "@chainsafe/blst";
import {
  computeEpochAtSlot,
  createSingleSignatureSetFromComponents,
  getExecutionPayloadBidSigningRoot,
  isActiveBuilder,
  isGasLimitTargetCompatible,
  isStatePostGloas,
} from "@lodestar/state-transition";
import {gloas} from "@lodestar/types";
import {byteArrayEquals, toHex, toRootHex} from "@lodestar/utils";
import {getShufflingDependentRoot} from "../../util/dependentRoot.js";
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

  // [IGNORE] `bid.parent_block_root` is the hash tree root of a known beacon block in fork choice.
  // Moved earlier than the spec ordering so we can derive the proposer dependent root for the
  // proposer-preferences lookup below from a known fork-choice block.
  const parentBlock = chain.forkChoice.getBlockHexDefaultStatus(parentBlockRootHex);
  if (parentBlock === null) {
    throw new ExecutionPayloadBidError(GossipAction.IGNORE, {
      code: ExecutionPayloadBidErrorCode.UNKNOWN_BLOCK_ROOT,
      parentBlockRoot: parentBlockRootHex,
    });
  }

  // [IGNORE] A `SignedProposerPreferences` matching `bid.slot` and the bid's branch has been
  // seen — i.e. `proposal_slot == bid.slot` AND `dependent_root ==
  // get_proposer_dependent_root(parent_state, compute_epoch_at_slot(bid.slot))`.
  const bidEpoch = computeEpochAtSlot(bid.slot);
  // gloas is always post-Fulu, so `get_proposer_dependent_root` is the post-Fulu (deterministic
  // proposer lookahead) form `block_root_at(start_slot(epoch - MIN_SEED_LOOKAHEAD) - 1)` with
  // `MIN_SEED_LOOKAHEAD == 1` — identical to the attester-shuffling dependent root for the same
  // epoch (both 1-epoch lookahead), hence `getShufflingDependentRoot`. `null` on a
  // unknown/finalized-pruned ancestor or genesis edge → degrade to IGNORE below instead of
  // letting a raw `ForkChoiceError` escape the `GossipActionError` contract.
  const dependentRootHex = (() => {
    try {
      return getShufflingDependentRoot(chain.forkChoice, bidEpoch, computeEpochAtSlot(parentBlock.slot), parentBlock);
    } catch {
      return null;
    }
  })();

  if (dependentRootHex === null) {
    // Could not derive the dependent root for this branch (unknown/finalized-pruned ancestor,
    // genesis edge, etc.) → definitionally no matching `SignedProposerPreferences`.
    throw new ExecutionPayloadBidError(GossipAction.IGNORE, {
      code: ExecutionPayloadBidErrorCode.NO_MATCHING_PROPOSER_PREFERENCES,
      slot: bid.slot,
      parentBlockRoot: parentBlockRootHex,
      dependentRoot: "unknown",
    });
  }

  const proposerPreferences = chain.proposerPreferencesPool.get(bid.slot, dependentRootHex);
  if (proposerPreferences === null) {
    throw new ExecutionPayloadBidError(GossipAction.IGNORE, {
      code: ExecutionPayloadBidErrorCode.NO_MATCHING_PROPOSER_PREFERENCES,
      slot: bid.slot,
      parentBlockRoot: parentBlockRootHex,
      dependentRoot: dependentRootHex,
    });
  }

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
  if (!byteArrayEquals(bid.feeRecipient, proposerPreferences.message.feeRecipient)) {
    throw new ExecutionPayloadBidError(GossipAction.REJECT, {
      code: ExecutionPayloadBidErrorCode.PROPOSER_PREFERENCES_FEE_RECIPIENT_MISMATCH,
      builderIndex: bid.builderIndex,
      bidFeeRecipient: toHex(bid.feeRecipient),
      expectedFeeRecipient: toHex(proposerPreferences.message.feeRecipient),
    });
  }

  // [IGNORE] `bid.parent_block_hash` is the block hash of a known execution payload in fork
  // choice. Looks up the variant of `bid.parent_block_root` whose payload hash matches
  // `bid.parent_block_hash` — works for both FULL parents (FULL variant carries the delivered
  // payload's hash) and EMPTY parents (EMPTY/PENDING variants carry the inherited parent
  // payload's hash, since the new block doesn't have its own payload). Variant carries the
  // executed payload's gas_limit, which we use as `parent_gas_limit` below.
  const parentPayloadVariant = chain.forkChoice.getBlockHexAndBlockHash(parentBlockRootHex, parentBlockHashHex);
  if (parentPayloadVariant === null || parentPayloadVariant.executionPayloadBlockHash === null) {
    throw new ExecutionPayloadBidError(GossipAction.IGNORE, {
      code: ExecutionPayloadBidErrorCode.UNKNOWN_PARENT_BLOCK_HASH,
      parentBlockHash: parentBlockHashHex,
    });
  }

  // [REJECT] `is_gas_limit_target_compatible(parent_gas_limit, bid.gas_limit, target_gas_limit)`,
  // where `parent_gas_limit` is the `gas_limit` of the parent execution payload and
  // `target_gas_limit` is `proposer_preferences.target_gas_limit`.
  const bidGasLimit = Number(bid.gasLimit);
  const parentGasLimit = parentPayloadVariant.executionPayloadGasLimit;
  const targetGasLimit = proposerPreferences.message.targetGasLimit;
  if (!isGasLimitTargetCompatible(parentGasLimit, bidGasLimit, targetGasLimit)) {
    throw new ExecutionPayloadBidError(GossipAction.REJECT, {
      code: ExecutionPayloadBidErrorCode.PROPOSER_PREFERENCES_GAS_LIMIT_MISMATCH,
      builderIndex: bid.builderIndex,
      bidGasLimit,
      parentGasLimit,
      targetGasLimit,
    });
  }

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
