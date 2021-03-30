import {allForks} from "@chainsafe/lodestar-types";
import {
  computeEpochAtSlot,
  computeSigningRoot,
  getDomain,
  ISignatureSet,
  SignatureSetType,
  verifySignatureSet,
} from "../../util";
import {CachedBeaconState} from "../util";

export function verifyRandaoSignature(
  state: CachedBeaconState<allForks.BeaconState>,
  block: allForks.BeaconBlock
): boolean {
  return verifySignatureSet(getRandaoRevealSignatureSet(state, block));
}

/**
 * Extract signatures to allow validating all block signatures at once
 */
export function getRandaoRevealSignatureSet(
  state: CachedBeaconState<allForks.BeaconState>,
  block: allForks.BeaconBlock
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
