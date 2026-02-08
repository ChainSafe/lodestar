import {BeaconConfig} from "@lodestar/config";
import {DOMAIN_RANDAO} from "@lodestar/params";
import {BeaconBlock, ssz} from "@lodestar/types";
import {Index2PubkeyCache} from "../cache/pubkeyCache.js";
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
  block: BeaconBlock
): boolean {
  return verifySignatureSet(getRandaoRevealSignatureSet(config, block), index2pubkey);
}

/**
 * Extract signatures to allow validating all block signatures at once
 */
export function getRandaoRevealSignatureSet(config: BeaconConfig, block: BeaconBlock): ISignatureSet {
  // should not get epoch from epochCtx
  const epoch = computeEpochAtSlot(block.slot);
  // the getDomain() api requires the state slot as 1st param, however it's the same to block.slot in state-transition
  // and the same epoch when we verify blocks in batch in beacon-node. So we can safely use block.slot here.
  const domain = config.getDomain(block.slot, DOMAIN_RANDAO, block.slot);

  return {
    type: SignatureSetType.indexed,
    index: block.proposerIndex,
    signingRoot: computeSigningRoot(ssz.Epoch, epoch, domain),
    signature: block.body.randaoReveal,
  };
}
