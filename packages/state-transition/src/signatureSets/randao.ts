import {BeaconConfig} from "@lodestar/config";
import {DOMAIN_RANDAO} from "@lodestar/params";
import {BeaconBlock, ssz} from "@lodestar/types";
import {Index2PubkeyCache} from "../cache/pubkeyCache.js";
import {CachedBeaconStateAllForks} from "../types.js";
import {
  ISignatureSet,
  SignatureSetType,
  computeEpochAtSlot,
  computeSigningRoot,
  verifySignatureSet,
} from "../util/index.js";

export function verifyRandaoSignature(
  config: BeaconConfig,
  index2pubkey: Index2PubkeyCache,
  state: CachedBeaconStateAllForks,
  block: BeaconBlock
): boolean {
  return verifySignatureSet(getRandaoRevealSignatureSet(config, index2pubkey, state, block));
}

/**
 * Extract signatures to allow validating all block signatures at once
 */
export function getRandaoRevealSignatureSet(
  config: BeaconConfig,
  index2pubkey: Index2PubkeyCache,
  state: CachedBeaconStateAllForks,
  block: BeaconBlock
): ISignatureSet {
  // should not get epoch from epochCtx
  const epoch = computeEpochAtSlot(block.slot);
  const domain = config.getDomain(state.slot, DOMAIN_RANDAO, block.slot);

  return {
    type: SignatureSetType.single,
    pubkey: index2pubkey[block.proposerIndex],
    signingRoot: computeSigningRoot(ssz.Epoch, epoch, domain),
    signature: block.body.randaoReveal,
  };
}
