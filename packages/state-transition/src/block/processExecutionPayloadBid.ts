import {PublicKey, Signature, verify} from "@chainsafe/blst";
import {byteArrayEquals} from "@chainsafe/ssz";
import {BUILDER_INDEX_SELF_BUILD, ForkPostGloas, SLOTS_PER_EPOCH} from "@lodestar/params";
import {BeaconBlock, gloas, ssz} from "@lodestar/types";
import {toHex, toRootHex} from "@lodestar/utils";
import {G2_POINT_AT_INFINITY} from "../constants/constants.ts";
import {getExecutionPayloadBidSigningRoot} from "../signatureSets/executionPayloadBid.js";
import {CachedBeaconStateGloas} from "../types.ts";
import {canBuilderCoverBid, isActiveBuilder} from "../util/gloas.ts";
import {getCurrentEpoch, getRandaoMix} from "../util/index.ts";

export function processExecutionPayloadBid(state: CachedBeaconStateGloas, block: BeaconBlock<ForkPostGloas>): void {
  const signedBid = block.body.signedExecutionPayloadBid;
  const bid = signedBid.message;
  const {builderIndex, value: amount} = bid;

  // For self-builds, amount must be zero regardless of withdrawal credential prefix
  if (builderIndex === BUILDER_INDEX_SELF_BUILD) {
    if (amount !== 0) {
      throw Error(`Invalid execution payload bid: self-build with non-zero amount ${amount}`);
    }
    if (!byteArrayEquals(signedBid.signature, G2_POINT_AT_INFINITY)) {
      throw Error("Invalid execution payload bid: self-build with non-zero signature");
    }
  }
  // Non-self builds require active builder with valid signature
  else {
    const builder = state.builders.getReadonly(builderIndex);

    // Verify that the builder is active
    if (!isActiveBuilder(builder, state.finalizedCheckpoint.epoch)) {
      throw Error(`Invalid execution payload bid: builder ${builderIndex} is not active`);
    }

    // Verify that the builder has funds to cover the bid
    if (!canBuilderCoverBid(state, builderIndex, amount)) {
      throw Error(`Invalid execution payload bid: builder ${builderIndex} has insufficient balance`);
    }

    // Verify that the bid signature is valid
    if (!verifyExecutionPayloadBidSignature(state, builder.pubkey, signedBid)) {
      throw Error(`Invalid execution payload bid: invalid signature for builder ${builderIndex}`);
    }
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
  const signingRoot = getExecutionPayloadBidSigningRoot(state.config, state.slot, signedBid.message);

  try {
    const publicKey = PublicKey.fromBytes(pubkey);
    const signature = Signature.fromBytes(signedBid.signature, true);

    return verify(signingRoot, publicKey, signature);
  } catch (_e) {
    return false; // Catch all BLS errors: failed key validation, failed signature validation, invalid signature
  }
}
