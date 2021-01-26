import xor from "buffer-xor";
import {hash} from "@chainsafe/ssz";
import {BeaconBlock} from "@chainsafe/lodestar-types";
import {DomainType} from "../../constants";
import {computeEpochAtSlot, computeSigningRoot, getDomain, getRandaoMix} from "../../util";
import {ISignatureSet, SignatureSetType, verifySignatureSet} from "../signatureSets";
import {CachedBeaconState} from "../util/cachedBeaconState";

export function processRandao(cachedState: CachedBeaconState, block: BeaconBlock, verifySignature = true): void {
  const config = cachedState.config;
  const epoch = cachedState.currentShuffling.epoch;
  const randaoReveal = block.body.randaoReveal.valueOf() as Uint8Array;

  // verify RANDAO reveal
  if (verifySignature) {
    const signatureSet = getRandaoRevealSignatureSet(cachedState, block);
    if (!verifySignatureSet(signatureSet)) {
      throw new Error("RANDAO reveal is an invalid signature");
    }
  }

  // mix in RANDAO reveal
  cachedState.randaoMixes[epoch % config.params.EPOCHS_PER_HISTORICAL_VECTOR] = xor(
    Buffer.from(getRandaoMix(config, cachedState, epoch) as Uint8Array),
    Buffer.from(hash(randaoReveal))
  );
}

/**
 * Extract signatures to allow validating all block signatures at once
 */
export function getRandaoRevealSignatureSet(cachedState: CachedBeaconState, block: BeaconBlock): ISignatureSet {
  const config = cachedState.config;
  // should not get epoch from epochCtx
  const epoch = computeEpochAtSlot(config, block.slot);
  const domain = getDomain(config, cachedState, DomainType.RANDAO);

  return {
    type: SignatureSetType.single,
    pubkey: cachedState.index2pubkey[block.proposerIndex],
    signingRoot: computeSigningRoot(config, config.types.Epoch, epoch, domain),
    signature: block.body.randaoReveal,
  };
}
