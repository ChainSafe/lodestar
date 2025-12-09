import {
  CachedBeaconStateGloas,
  createSingleSignatureSetFromComponents,
  getCurrentEpoch,
  getExecutionPayloadBidSigningRoot,
  hasBuilderWithdrawalCredential,
  isActiveValidator,
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
  const state = await chain.getHeadStateAtCurrentEpoch(RegenCaller.validateGossipExecutionPayloadBid);

  // [REJECT] `bid.builder_index` is a valid, active, and non-slashed builder
  // index.
  const builder = state.validators.getReadonly(bid.builderIndex);
  if (builder.slashed || !isActiveValidator(builder, getCurrentEpoch(state))) {
    throw new ExecutionPayloadBidError(GossipAction.REJECT, {
      code: ExecutionPayloadBidErrorCode.BUILDER_NOT_ELIGIBLE,
      builderIndex: bid.builderIndex,
    });
  }

  // [REJECT] the builder's withdrawal credentials' prefix is
  // `BUILDER_WITHDRAWAL_PREFIX` -- i.e.
  // `is_builder_withdrawal_credential(state.validators[bid.builder_index].withdrawal_credentials)`
  // returns `True`.
  if (!hasBuilderWithdrawalCredential(builder.withdrawalCredentials)) {
    throw new ExecutionPayloadBidError(GossipAction.REJECT, {
      code: ExecutionPayloadBidErrorCode.BUILDER_BAD_CREDENTIALS,
      builderIndex: bid.builderIndex,
    });
  }

  // [IGNORE] this is the first signed bid seen with a valid signature from the
  // given builder for this slot.
  // [IGNORE] this bid is the highest value bid seen for the corresponding slot
  // and the given parent block hash.
  // [IGNORE] `bid.value` is less or equal than the builder's excess balance --
  // i.e.
  // `MIN_ACTIVATION_BALANCE + bid.value <= state.balances[bid.builder_index]`.
  // [IGNORE] `bid.parent_block_hash` is the block hash of a known execution
  // payload in fork choice.
  // TODO GLOAS: implement this

  // [IGNORE] `bid.parent_block_root` is the hash tree root of a known beacon
  // block in fork choice.
  const block = chain.forkChoice.getBlock(bid.parentBlockRoot);
  if (block === null) {
    throw new ExecutionPayloadBidError(GossipAction.IGNORE, {
      code: ExecutionPayloadBidErrorCode.UNKNOWN_BLOCK_ROOT,
      parentBlockRoot: toRootHex(bid.parentBlockRoot),
    });
  }

  // [IGNORE] `bid.slot` is the current slot or the next slot.
  const currentSlot = chain.clock.currentSlot;
  if (bid.slot !== currentSlot && bid.slot !== currentSlot + 1) {
    throw new ExecutionPayloadBidError(GossipAction.IGNORE, {
      code: ExecutionPayloadBidErrorCode.INVALID_SLOT,
      slot: bid.slot,
    });
  }

  // [REJECT] `signed_execution_payload_bid.signature` is valid with respect to the `bid.builder_index`.
  // TODO GLOAS: implement thi
  const signatureSet = createSingleSignatureSetFromComponents(
    chain.index2pubkey[bid.builderIndex],
    getExecutionPayloadBidSigningRoot(state as CachedBeaconStateGloas, bid),
    signedExecutionPayloadBid.signature
  );

  if (!(await chain.bls.verifySignatureSets([signatureSet]))) {
    throw new ExecutionPayloadBidError(GossipAction.REJECT, {
      code: ExecutionPayloadBidErrorCode.INVALID_SIGNATURE,
    });
  }

  // Valid
}
