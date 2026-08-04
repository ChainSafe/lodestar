import {PublicKey} from "@chainsafe/blst";
import {IForkChoice, ProtoBlock} from "@lodestar/fork-choice";
import {PAYLOAD_BUILDER_VERSION} from "@lodestar/params";
import {
  computeEpochAtSlot,
  createSingleSignatureSetFromComponents,
  getExecutionPayloadBidSigningRoot,
  isActiveBuilder,
  isGasLimitTargetCompatible,
  isStartSlotOfEpoch,
  isStatePostGloas,
} from "@lodestar/state-transition";
import {RootHex, Slot, ValidatorIndex, gloas} from "@lodestar/types";
import {byteArrayEquals, toHex, toRootHex} from "@lodestar/utils";
import {getShufflingDependentRoot} from "../../util/dependentRoot.js";
import {ExecutionPayloadBidError, ExecutionPayloadBidErrorCode, GossipAction} from "../errors/index.js";
import {IBeaconChain} from "../index.js";
import {RegenCaller} from "../regen/index.js";

/**
 * Relative increment over the current highest bid required to forward a bid, in basis points.
 * With 3%, laddering from 1 gwei to 1 ETH takes ~256 bids given the floor and cap below, see
 * https://github.com/ethereum/consensus-specs/pull/4792#issuecomment-3714553549.
 */
const BID_INCREMENT_BPS = 300;
/**
 * Minimum absolute increment (0.0001 ETH). Covers low bid values where the relative increment
 * is tiny and provides weak spam protection.
 */
const BID_INCREMENT_FLOOR_GWEI = 100_000;
/**
 * Maximum absolute increment (0.01 ETH). Bounds the barrier for legitimate competition on
 * high value blocks where the relative increment would suppress closely competing bids.
 */
const BID_INCREMENT_CAP_GWEI = 10_000_000;

/**
 * Return the minimum value a new bid must have to be forwarded given the current highest bid.
 * Division before multiplication to stay within safe integer range for max gwei values.
 */
function getMinBidValue(currentHighestBid: number): number {
  const relativeIncrement = Math.floor(currentHighestBid / 10_000) * BID_INCREMENT_BPS;
  const increment = Math.min(Math.max(BID_INCREMENT_FLOOR_GWEI, relativeIncrement), BID_INCREMENT_CAP_GWEI);
  return currentHighestBid + increment;
}

/**
 * Check whether a bid builds on one of the paths compatible with the local head branch.
 *
 * Building directly on the parent is allowed for proposer-boost reorgs outside epoch boundaries.
 * Otherwise the bid must build on the local head's full or empty payload variant, as selected for its slot.
 */
function isBidCompatibleWithHead(
  forkChoice: IForkChoice,
  head: ProtoBlock,
  bidSlot: Slot,
  bidParentBlockRoot: RootHex,
  bidParentBlockHash: RootHex
): boolean {
  const buildsOnParentBlock = bidParentBlockRoot === head.parentRoot;
  const buildsOnParentPayload = bidParentBlockHash === head.parentBlockHash;

  if (buildsOnParentBlock && buildsOnParentPayload) {
    // The spec allows this at epoch boundaries, but Lodestar does not propagate these bids because validating
    // them requires an epoch transition for a parent state that cannot be used for proposer-boost reorgs.
    return !isStartSlotOfEpoch(bidSlot);
  }

  if (bidParentBlockRoot !== head.blockRoot) {
    return false;
  }

  const buildsOnHeadPayload = bidParentBlockHash === head.executionPayloadBlockHash;

  if (forkChoice.shouldBuildOnFull(head, bidSlot)) {
    return buildsOnHeadPayload;
  }

  return buildsOnParentPayload;
}

export async function validateApiExecutionPayloadBid(
  chain: IBeaconChain,
  signedExecutionPayloadBid: gloas.SignedExecutionPayloadBid
): Promise<{proposerIndex: ValidatorIndex}> {
  return validateExecutionPayloadBid(chain, signedExecutionPayloadBid);
}

export async function validateGossipExecutionPayloadBid(
  chain: IBeaconChain,
  signedExecutionPayloadBid: gloas.SignedExecutionPayloadBid
): Promise<{proposerIndex: ValidatorIndex}> {
  return validateExecutionPayloadBid(chain, signedExecutionPayloadBid);
}

async function validateExecutionPayloadBid(
  chain: IBeaconChain,
  signedExecutionPayloadBid: gloas.SignedExecutionPayloadBid
): Promise<{proposerIndex: ValidatorIndex}> {
  const bid = signedExecutionPayloadBid.message;
  const bidParentBlockRoot = toRootHex(bid.parentBlockRoot);
  const bidParentBlockHash = toRootHex(bid.parentBlockHash);

  // [IGNORE] `bid.slot` is the current slot, or the next slot (`bid.slot - 1` is current), allowing for `MAXIMUM_GOSSIP_CLOCK_DISPARITY`.
  if (
    !chain.clock.isCurrentSlotGivenGossipDisparity(bid.slot) &&
    !chain.clock.isCurrentSlotGivenGossipDisparity(bid.slot - 1)
  ) {
    throw new ExecutionPayloadBidError(GossipAction.IGNORE, {
      code: ExecutionPayloadBidErrorCode.INVALID_SLOT,
      builderIndex: bid.builderIndex,
      slot: bid.slot,
    });
  }

  // [IGNORE] The bid is compatible with the current head branch.
  const head = chain.forkChoice.getHead();
  if (!isBidCompatibleWithHead(chain.forkChoice, head, bid.slot, bidParentBlockRoot, bidParentBlockHash)) {
    throw new ExecutionPayloadBidError(GossipAction.IGNORE, {
      code: ExecutionPayloadBidErrorCode.INCOMPATIBLE_WITH_HEAD,
      slot: bid.slot,
      parentBlockRoot: bidParentBlockRoot,
      parentBlockHash: bidParentBlockHash,
      headBlockRoot: head.blockRoot,
    });
  }

  // [IGNORE] this is the first signed bid seen with a valid signature from the given builder for
  // the tuple `(bid.slot, bid.parent_block_hash, bid.parent_block_root)`.
  // Entries are only added after signature verification, so known tuples can be dropped before
  // state regeneration and the other expensive validation steps.
  if (chain.seenExecutionPayloadBids.isKnown(bid.slot, bid.builderIndex, bidParentBlockHash, bidParentBlockRoot)) {
    throw new ExecutionPayloadBidError(GossipAction.IGNORE, {
      code: ExecutionPayloadBidErrorCode.BID_ALREADY_KNOWN,
      builderIndex: bid.builderIndex,
      slot: bid.slot,
      parentBlockRoot: bidParentBlockRoot,
      parentBlockHash: bidParentBlockHash,
    });
  }

  // [IGNORE] `bid.parent_block_root` is the hash tree root of a known beacon block in fork choice.
  // Moved earlier than the spec ordering so we can derive the proposer dependent root for the
  // proposer-preferences lookup below from a known fork-choice block.
  const parentBlock = chain.forkChoice.getBlockHexDefaultStatus(bidParentBlockRoot);
  if (parentBlock === null) {
    throw new ExecutionPayloadBidError(GossipAction.IGNORE, {
      code: ExecutionPayloadBidErrorCode.UNKNOWN_BLOCK_ROOT,
      parentBlockRoot: bidParentBlockRoot,
    });
  }

  // [REJECT] The bid is for a higher slot than its parent block -- i.e.
  // validate that `bid.slot` is greater than the slot of the block with root
  // `bid.parent_block_root`.
  if (bid.slot <= parentBlock.slot) {
    throw new ExecutionPayloadBidError(GossipAction.REJECT, {
      code: ExecutionPayloadBidErrorCode.NOT_LATER_THAN_PARENT,
      parentSlot: parentBlock.slot,
      slot: bid.slot,
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
      parentBlockRoot: bidParentBlockRoot,
      dependentRoot: "unknown",
    });
  }

  const proposerPreferences = chain.proposerPreferencesPool.get(bid.slot, dependentRootHex);
  if (proposerPreferences === null) {
    throw new ExecutionPayloadBidError(GossipAction.IGNORE, {
      code: ExecutionPayloadBidErrorCode.NO_MATCHING_PROPOSER_PREFERENCES,
      slot: bid.slot,
      parentBlockRoot: bidParentBlockRoot,
      dependentRoot: dependentRootHex,
    });
  }

  // Use the bid's parent branch state for builder checks
  const state = await chain.regen
    .getBlockSlotState(parentBlock, bid.slot, {dontTransferCache: true}, RegenCaller.validateGossipExecutionPayloadBid)
    .catch(() => {
      throw new ExecutionPayloadBidError(GossipAction.IGNORE, {
        code: ExecutionPayloadBidErrorCode.UNKNOWN_BLOCK_ROOT,
        parentBlockRoot: bidParentBlockRoot,
      });
    });

  if (!isStatePostGloas(state)) {
    throw new Error(`Expected gloas+ state for execution payload bid validation, got fork=${state.forkName}`);
  }

  // [REJECT] `bid.builder_index` is within bounds -- i.e. `bid.builder_index < len(state.builders)`.
  // `state.getBuilder` returns a lazy SSZ `getReadonly` view that is not bounds-checked eagerly; an
  // out-of-range index only throws (`LeafNode has no right node`) on deferred field access (e.g. inside
  // `isActiveBuilder`), escaping a try/catch around `getBuilder`. Check the length explicitly instead.
  if (bid.builderIndex >= state.getBuildersLength()) {
    throw new ExecutionPayloadBidError(GossipAction.REJECT, {
      code: ExecutionPayloadBidErrorCode.BUILDER_NOT_ELIGIBLE,
      builderIndex: bid.builderIndex,
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

  // [REJECT] The builder version is `PAYLOAD_BUILDER_VERSION` -- i.e.
  // `state.builders[bid.builder_index].version == PAYLOAD_BUILDER_VERSION`.
  if (builder.version !== PAYLOAD_BUILDER_VERSION) {
    throw new ExecutionPayloadBidError(GossipAction.REJECT, {
      code: ExecutionPayloadBidErrorCode.INVALID_BUILDER_VERSION,
      builderIndex: bid.builderIndex,
      version: builder.version,
      expectedVersion: PAYLOAD_BUILDER_VERSION,
    });
  }

  // [REJECT] `bid.execution_payment` is zero.
  if (bid.executionPayment !== 0n) {
    throw new ExecutionPayloadBidError(GossipAction.REJECT, {
      code: ExecutionPayloadBidErrorCode.NON_ZERO_EXECUTION_PAYMENT,
      builderIndex: bid.builderIndex,
      executionPayment: bid.executionPayment,
    });
  }

  // [IGNORE] `bid.fee_recipient == proposer_preferences.fee_recipient`.
  if (!byteArrayEquals(bid.feeRecipient, proposerPreferences.message.feeRecipient)) {
    throw new ExecutionPayloadBidError(GossipAction.IGNORE, {
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
  const parentPayloadVariant = chain.forkChoice.getBlockHexAndBlockHash(bidParentBlockRoot, bidParentBlockHash);
  if (parentPayloadVariant === null || parentPayloadVariant.executionPayloadBlockHash === null) {
    throw new ExecutionPayloadBidError(GossipAction.IGNORE, {
      code: ExecutionPayloadBidErrorCode.UNKNOWN_PARENT_BLOCK_HASH,
      parentBlockHash: bidParentBlockHash,
    });
  }

  // [IGNORE] `is_gas_limit_target_compatible(parent_gas_limit, bid.gas_limit, target_gas_limit)`,
  // where `parent_gas_limit` is the `gas_limit` of the parent execution payload and
  // `target_gas_limit` is `proposer_preferences.target_gas_limit`.
  const bidGasLimit = bid.gasLimit;
  const parentGasLimit = BigInt(parentPayloadVariant.executionPayloadGasLimit);
  const targetGasLimit = proposerPreferences.message.targetGasLimit;
  if (!isGasLimitTargetCompatible(parentGasLimit, bidGasLimit, targetGasLimit)) {
    throw new ExecutionPayloadBidError(GossipAction.IGNORE, {
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

  // [IGNORE] this bid is the highest value bid seen for the tuple
  // `(bid.slot, bid.parent_block_hash, bid.parent_block_root)`.
  // As a DoS prevention measure, the bid must also exceed the current highest bid by a minimum
  // increment, see https://github.com/ethereum/consensus-specs/pull/4831. This prevents spam
  // from builders submitting numerous bids with minimal value increments.
  const bestBid = chain.executionPayloadBidPool.getBestBid(bid.slot, bidParentBlockHash, bidParentBlockRoot);
  if (bestBid !== null && bid.value < getMinBidValue(bestBid.message.value)) {
    throw new ExecutionPayloadBidError(GossipAction.IGNORE, {
      code: ExecutionPayloadBidErrorCode.BID_TOO_LOW,
      bidValue: bid.value,
      currentHighestBid: bestBid.message.value,
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

  // [REJECT] `bid.prev_randao` is the correct RANDAO mix -- i.e. validate that
  // `bid.prev_randao == get_randao_mix(parent_state, get_current_epoch(parent_state))`.
  const randaoMix = state.getRandaoMix(computeEpochAtSlot(state.slot));
  if (!byteArrayEquals(bid.prevRandao, randaoMix)) {
    throw new ExecutionPayloadBidError(GossipAction.REJECT, {
      code: ExecutionPayloadBidErrorCode.INVALID_PREV_RANDAO,
      builderIndex: bid.builderIndex,
      bidPrevRandao: toHex(bid.prevRandao),
      expectedPrevRandao: toHex(randaoMix),
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

  // Repeat the seen check after the awaited signature verification to prevent concurrent bids
  // for the same builder and tuple from both passing validation.
  if (chain.seenExecutionPayloadBids.isKnown(bid.slot, bid.builderIndex, bidParentBlockHash, bidParentBlockRoot)) {
    throw new ExecutionPayloadBidError(GossipAction.IGNORE, {
      code: ExecutionPayloadBidErrorCode.BID_ALREADY_KNOWN,
      builderIndex: bid.builderIndex,
      slot: bid.slot,
      parentBlockRoot: bidParentBlockRoot,
      parentBlockHash: bidParentBlockHash,
    });
  }

  // Valid
  chain.seenExecutionPayloadBids.add(bid.slot, bid.builderIndex, bidParentBlockHash, bidParentBlockRoot);

  return {proposerIndex: proposerPreferences.message.validatorIndex};
}
