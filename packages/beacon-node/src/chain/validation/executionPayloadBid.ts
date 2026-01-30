import {PublicKey} from "@chainsafe/blst";
import {
  CachedBeaconStateGloas,
  canBuilderCoverBid,
  createSingleSignatureSetFromComponents,
  getExecutionPayloadBidSigningRoot,
  isActiveBuilder,
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
  const state = (await chain.getHeadStateAtCurrentEpoch(
    RegenCaller.validateGossipExecutionPayloadBid
  )) as CachedBeaconStateGloas;

  // [IGNORE] `bid.slot` is the current slot or the next slot.
  const currentSlot = chain.clock.currentSlot;
  if (bid.slot !== currentSlot && bid.slot !== currentSlot + 1) {
    throw new ExecutionPayloadBidError(GossipAction.IGNORE, {
      code: ExecutionPayloadBidErrorCode.INVALID_SLOT,
      builderIndex: bid.builderIndex,
      slot: bid.slot,
    });
  }

  // [IGNORE] the `SignedProposerPreferences` where `preferences.proposal_slot`
  // is equal to `bid.slot` has been seen.
  // TODO GLOAS: Implement this along with proposer preference

  // [REJECT] `bid.builder_index` is a valid/active builder index -- i.e.
  // `is_active_builder(state, bid.builder_index)` returns `True`.
  if (!isActiveBuilder(state, bid.builderIndex)) {
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

  // [REJECT] `bid.fee_recipient` matches the `fee_recipient` from the proposer's
  // `SignedProposerPreferences` associated with `bid.slot`.
  // [REJECT] `bid.gas_limit` matches the `gas_limit` from the proposer's
  // `SignedProposerPreferences` associated with `bid.slot`.
  // TODO GLOAS: Implement this along with proposer preference

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

  // [IGNORE] this bid is the highest value bid seen for the corresponding slot
  // and the given parent block hash.
  const bestBid = chain.executionPayloadBidPool.getBestBid(parentBlockRootHex, parentBlockHashHex, bid.slot);
  if (bestBid !== null && bestBid.value >= bid.value) {
    throw new ExecutionPayloadBidError(GossipAction.IGNORE, {
      code: ExecutionPayloadBidErrorCode.BID_TOO_LOW,
      bidValue: bid.value,
      currentHighestBid: bestBid.value,
    });
  }
  // [IGNORE] `bid.value` is less or equal than the builder's excess balance --
  // i.e. `can_builder_cover_bid(state, builder_index, amount)` returns `True`.
  if (!canBuilderCoverBid(state, bid.builderIndex, bid.value)) {
    throw new ExecutionPayloadBidError(GossipAction.IGNORE, {
      code: ExecutionPayloadBidErrorCode.BID_TOO_HIGH,
      bidValue: bid.value,
      builderBalance: state.builders.getReadonly(bid.builderIndex).balance,
    });
  }

  // [IGNORE] `bid.parent_block_hash` is the block hash of a known execution
  // payload in fork choice.
  // TODO GLOAS: implement this

  // [IGNORE] `bid.parent_block_root` is the hash tree root of a known beacon
  // block in fork choice.
  const block = chain.forkChoice.getBlock(bid.parentBlockRoot);
  if (block === null) {
    throw new ExecutionPayloadBidError(GossipAction.IGNORE, {
      code: ExecutionPayloadBidErrorCode.UNKNOWN_BLOCK_ROOT,
      parentBlockRoot: parentBlockRootHex,
    });
  }

  // [REJECT] `signed_execution_payload_bid.signature` is valid with respect to the `bid.builder_index`.
  const signatureSet = createSingleSignatureSetFromComponents(
    PublicKey.fromBytes(state.builders.getReadonly(bid.builderIndex).pubkey),
    getExecutionPayloadBidSigningRoot(chain.config, state as CachedBeaconStateGloas, bid),
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
