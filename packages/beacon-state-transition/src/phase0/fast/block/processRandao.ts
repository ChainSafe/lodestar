import xor from "buffer-xor";
import {hash} from "@chainsafe/ssz";
import {phase0} from "@chainsafe/lodestar-types";
import {computeEpochAtSlot, computeSigningRoot, getDomain, getRandaoMix} from "../../../util";
import {CachedBeaconState} from "../util";
import {ISignatureSet, SignatureSetType, verifySignatureSet} from "../signatureSets";

export function processRandao(
  state: CachedBeaconState<phase0.BeaconState>,
  block: phase0.BeaconBlock,
  verifySignature = true
): void {
  const {config, epochCtx} = state;
  const epoch = epochCtx.currentShuffling.epoch;
  const randaoReveal = block.body.randaoReveal.valueOf() as Uint8Array;

  // verify RANDAO reveal
  if (verifySignature) {
    const signatureSet = getRandaoRevealSignatureSet(state, block);
    if (!verifySignatureSet(signatureSet)) {
      throw new Error("RANDAO reveal is an invalid signature");
    }
  }

  // mix in RANDAO reveal
  state.randaoMixes[epoch % config.params.EPOCHS_PER_HISTORICAL_VECTOR] = xor(
    Buffer.from(getRandaoMix(config, state, epoch) as Uint8Array),
    Buffer.from(hash(randaoReveal))
  );
}

/**
 * Extract signatures to allow validating all block signatures at once
 */
export function getRandaoRevealSignatureSet(
  state: CachedBeaconState<phase0.BeaconState>,
  block: phase0.BeaconBlock
): ISignatureSet {
  const {config, epochCtx} = state;
  // should not get epoch from epochCtx
  const epoch = computeEpochAtSlot(config, block.slot);
  const domain = getDomain(config, state, config.params.DOMAIN_RANDAO);

  return {
    type: SignatureSetType.single,
    pubkey: epochCtx.index2pubkey[block.proposerIndex],
    signingRoot: computeSigningRoot(config, config.types.Epoch, epoch, domain),
    signature: block.body.randaoReveal,
  };
}
