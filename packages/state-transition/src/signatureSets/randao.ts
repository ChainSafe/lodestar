import {DOMAIN_RANDAO} from "@lodestar/params";
import {allForks, ssz} from "@lodestar/types";
import {
  computeEpochAtSlot,
  computeSigningRoot,
  ISignatureSet,
  SignatureSetType,
  verifySignatureSet,
} from "../util/index.js";
import {CachedBeaconStateAllForks} from "../types.js";

export function verifyRandaoSignature(state: CachedBeaconStateAllForks, block: allForks.BeaconBlock): boolean {
  return verifySignatureSet(getRandaoRevealSignatureSet(state, block));
}

/**
 * Extract signatures to allow validating all block signatures at once
 */
export function getRandaoRevealSignatureSet(
  state: CachedBeaconStateAllForks,
  block: allForks.BeaconBlock
): ISignatureSet {
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
