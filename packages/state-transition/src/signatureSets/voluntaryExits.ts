import {SignedBeaconBlock, phase0, ssz} from "@lodestar/types";
import {Index2PubkeyCache} from "../cache/pubkeyCache.js";
import {CachedBeaconStateAllForks} from "../types.js";
import {
  ISignatureSet,
  SignatureSetType,
  computeSigningRoot,
  computeStartSlotAtEpoch,
  verifySignatureSet,
} from "../util/index.js";

export function verifyVoluntaryExitSignature(
  index2pubkey: Index2PubkeyCache,
  state: CachedBeaconStateAllForks,
  signedVoluntaryExit: phase0.SignedVoluntaryExit
): boolean {
  return verifySignatureSet(getVoluntaryExitSignatureSet(index2pubkey, state, signedVoluntaryExit));
}

/**
 * Extract signatures to allow validating all block signatures at once
 */
export function getVoluntaryExitSignatureSet(
  index2pubkey: Index2PubkeyCache,
  state: CachedBeaconStateAllForks,
  signedVoluntaryExit: phase0.SignedVoluntaryExit
): ISignatureSet {
  const slot = computeStartSlotAtEpoch(signedVoluntaryExit.message.epoch);
  const domain = state.config.getDomainForVoluntaryExit(state.slot, slot);

  return {
    type: SignatureSetType.single,
    pubkey: index2pubkey[signedVoluntaryExit.message.validatorIndex],
    signingRoot: computeSigningRoot(ssz.phase0.VoluntaryExit, signedVoluntaryExit.message, domain),
    signature: signedVoluntaryExit.signature,
  };
}

export function getVoluntaryExitsSignatureSets(
  index2pubkey: Index2PubkeyCache,
  state: CachedBeaconStateAllForks,
  signedBlock: SignedBeaconBlock
): ISignatureSet[] {
  return signedBlock.message.body.voluntaryExits.map((voluntaryExit) =>
    getVoluntaryExitSignatureSet(index2pubkey, state, voluntaryExit)
  );
}
