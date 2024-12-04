import {SignedBeaconBlock, phase0, ssz} from "@lodestar/types";
import {CachedBeaconStateAllForks} from "../types.js";
import {
  ISignatureSet,
  SignatureSetType,
  computeSigningRoot,
  computeStartSlotAtEpoch,
  verifySignatureSet,
} from "../util/index.js";

export function verifyVoluntaryExitSignature(
  state: CachedBeaconStateAllForks,
  signedVoluntaryExit: phase0.SignedVoluntaryExit
): boolean {
  return verifySignatureSet(getVoluntaryExitSignatureSet(state, signedVoluntaryExit));
}

/**
 * Extract signatures to allow validating all block signatures at once
 */
export function getVoluntaryExitSignatureSet(
  state: CachedBeaconStateAllForks,
  signedVoluntaryExit: phase0.SignedVoluntaryExit
): ISignatureSet {
  const {epochCtx} = state;
  const slot = computeStartSlotAtEpoch(signedVoluntaryExit.message.epoch);
  const domain = state.config.getDomainForVoluntaryExit(state.slot, slot);

  return {
    type: SignatureSetType.single,
    pubkey: epochCtx.index2pubkey[signedVoluntaryExit.message.validatorIndex],
    signingRoot: computeSigningRoot(ssz.phase0.VoluntaryExit, signedVoluntaryExit.message, domain),
    signature: signedVoluntaryExit.signature,
  };
}

export function getVoluntaryExitsSignatureSets(
  state: CachedBeaconStateAllForks,
  signedBlock: SignedBeaconBlock
): ISignatureSet[] {
  return signedBlock.message.body.voluntaryExits.map((voluntaryExit) =>
    getVoluntaryExitSignatureSet(state, voluntaryExit)
  );
}
