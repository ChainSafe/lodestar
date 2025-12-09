import {PublicKey, Signature, verify} from "@chainsafe/blst";
import {byteArrayEquals} from "@chainsafe/ssz";
import {
  DOMAIN_BEACON_BUILDER,
  FAR_FUTURE_EPOCH,
  ForkPostGloas,
  MIN_ACTIVATION_BALANCE,
  SLOTS_PER_EPOCH,
} from "@lodestar/params";
import {BeaconBlock, gloas, ssz} from "@lodestar/types";
import {toHex, toRootHex} from "@lodestar/utils";
import {G2_POINT_AT_INFINITY} from "../constants/constants.ts";
import {CachedBeaconStateGloas} from "../types.ts";
import {hasBuilderWithdrawalCredential} from "../util/gloas.ts";
import {computeSigningRoot, getCurrentEpoch, getRandaoMix, isActiveValidator} from "../util/index.ts";

export function processExecutionPayloadBid(state: CachedBeaconStateGloas, block: BeaconBlock<ForkPostGloas>): void {
  const signedBid = block.body.signedExecutionPayloadBid;
  const bid = signedBid.message;
  const {builderIndex, value: amount} = bid;
  const builder = state.validators.getReadonly(builderIndex);

  // For self-builds, amount must be zero regardless of withdrawal credential prefix
  if (builderIndex === block.proposerIndex) {
    if (amount !== 0) {
      throw Error(`Invalid execution payload bid: self-build with non-zero amount ${amount}`);
    }
    if (!byteArrayEquals(signedBid.signature, G2_POINT_AT_INFINITY)) {
      throw Error("Invalid execution payload bid: self-build with non-zero signature");
    }
    // Non-self builds require builder withdrawal credential
  } else {
    if (!hasBuilderWithdrawalCredential(builder.withdrawalCredentials)) {
      throw Error(`Invalid execution payload bid: builder ${builderIndex} does not have builder withdrawal credential`);
    }

    if (!verifyExecutionPayloadBidSignature(state, builder.pubkey, signedBid)) {
      throw Error(`Invalid execution payload bid: invalid signature for builder ${builderIndex}`);
    }
  }

  if (!isActiveValidator(builder, getCurrentEpoch(state))) {
    throw Error(`Invalid execution payload bid: builder ${builderIndex} is not active`);
  }

  if (builder.slashed) {
    throw Error(`Invalid execution payload bid: builder ${builderIndex} is slashed`);
  }

  const pendingPayments = state.builderPendingPayments
    .getAllReadonly()
    .filter((payment) => payment.withdrawal.builderIndex === builderIndex)
    .reduce((acc, payment) => acc + payment.withdrawal.amount, 0);
  const pendingWithdrawals = state.builderPendingWithdrawals
    .getAllReadonly()
    .filter((withdrawal) => withdrawal.builderIndex === builderIndex)
    .reduce((acc, withdrawal) => acc + withdrawal.amount, 0);

  if (
    amount !== 0 &&
    state.balances.get(builderIndex) < amount + pendingPayments + pendingWithdrawals + MIN_ACTIVATION_BALANCE
  ) {
    throw Error("Insufficient builder balance");
  }

  if (bid.slot !== block.slot) {
    throw Error(`Bid slot ${bid.slot} does not match block slot ${block.slot}`);
  }

  if (!byteArrayEquals(bid.parentBlockHash, state.latestBlockHash)) {
    throw Error(
      `Parent block hash ${toRootHex(bid.parentBlockHash)} of bid does not match state's latest block hash ${toRootHex(state.latestBlockHash)}`
    );
  }

  if (!byteArrayEquals(bid.parentBlockRoot, block.parentRoot)) {
    throw Error(
      `Parent block root ${toRootHex(bid.parentBlockRoot)} of bid does not match block's parent root ${toRootHex(block.parentRoot)}`
    );
  }

  const stateRandao = getRandaoMix(state, getCurrentEpoch(state));
  if (!byteArrayEquals(bid.prevRandao, stateRandao)) {
    throw Error(`Prev randao ${toHex(bid.prevRandao)} of bid does not match state's randao mix ${toHex(stateRandao)}`);
  }

  if (amount > 0) {
    const pendingPaymentView = ssz.gloas.BuilderPendingPayment.toViewDU({
      weight: 0,
      withdrawal: ssz.gloas.BuilderPendingWithdrawal.toViewDU({
        feeRecipient: bid.feeRecipient,
        amount,
        builderIndex,
        withdrawableEpoch: FAR_FUTURE_EPOCH,
      }),
    });

    state.builderPendingPayments.set(SLOTS_PER_EPOCH + (bid.slot % SLOTS_PER_EPOCH), pendingPaymentView);
  }

  state.latestExecutionPayloadBid = ssz.gloas.ExecutionPayloadBid.toViewDU(bid);
}

function verifyExecutionPayloadBidSignature(
  state: CachedBeaconStateGloas,
  pubkey: Uint8Array,
  signedBid: gloas.SignedExecutionPayloadBid
): boolean {
  const domain = state.config.getDomain(state.slot, DOMAIN_BEACON_BUILDER);
  const signingRoot = computeSigningRoot(ssz.gloas.ExecutionPayloadBid, signedBid.message, domain);

  try {
    const publicKey = PublicKey.fromBytes(pubkey);
    const signature = Signature.fromBytes(signedBid.signature, true);

    return verify(signingRoot, publicKey, signature);
  } catch (_e) {
    return false; // Catch all BLS errors: failed key validation, failed signature validation, invalid signature
  }
}
