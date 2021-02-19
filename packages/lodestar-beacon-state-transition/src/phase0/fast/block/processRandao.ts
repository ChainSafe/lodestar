import xor from "buffer-xor";
import {hash} from "@chainsafe/ssz";
import {phase0} from "@chainsafe/lodestar-types";
import {DomainType} from "../../../constants";
import {computeEpochAtSlot, computeSigningRoot, getDomain, getRandaoMix} from "../../../util";
import {EpochContext} from "../util";
import {ISignatureSet, SignatureSetType, verifySignatureSet} from "../signatureSets";

export function processRandao(
  epochCtx: EpochContext,
  state: phase0.BeaconState,
  block: phase0.BeaconBlock,
  verifySignature = true
): void {
  const config = epochCtx.config;
  const epoch = epochCtx.currentShuffling.epoch;
  const randaoReveal = block.body.randaoReveal.valueOf() as Uint8Array;

  // verify RANDAO reveal
  if (verifySignature) {
    const signatureSet = getRandaoRevealSignatureSet(epochCtx, state, block);
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
  epochCtx: EpochContext,
  state: phase0.BeaconState,
  block: phase0.BeaconBlock
): ISignatureSet {
  const config = epochCtx.config;
  // should not get epoch from epochCtx
  const epoch = computeEpochAtSlot(config, block.slot);
  const domain = getDomain(config, state, DomainType.RANDAO);

  return {
    type: SignatureSetType.single,
    pubkey: epochCtx.index2pubkey[block.proposerIndex],
    signingRoot: computeSigningRoot(config, config.types.Epoch, epoch, domain),
    signature: block.body.randaoReveal,
  };
}
