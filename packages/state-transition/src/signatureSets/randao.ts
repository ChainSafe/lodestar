import {DOMAIN_RANDAO} from "@lodestar/params";
import {BeaconBlock, ssz} from "@lodestar/types";
import {CachedBeaconStateAllForks} from "../types.js";
import {
  ISignatureSet,
  SignatureSetType,
  computeEpochAtSlot,
  computeSigningRoot,
  verifySignatureSet,
} from "../util/index.js";

export function verifyRandaoSignature(state: CachedBeaconStateAllForks, block: BeaconBlock): boolean {
  return verifySignatureSet(getRandaoRevealSignatureSet(state, block));
}

/**
 * Extract signatures to allow validating all block signatures at once
 */
export function getRandaoRevealSignatureSet(state: CachedBeaconStateAllForks, block: BeaconBlock): ISignatureSet {
  const {epochCtx} = state;
  // should not get epoch from epochCtx
  const epoch = computeEpochAtSlot(block.slot);
  const domain = state.config.getDomain(state.slot, DOMAIN_RANDAO, block.slot);

  return {
    type: SignatureSetType.single,
    pubkey: epochCtx.index2pubkey[block.proposerIndex],
    signingRoot: computeSigningRoot(ssz.Epoch, epoch, domain),
    signature: block.body.randaoReveal,
  };
}
