import {DOMAIN_VOLUNTARY_EXIT} from "@lodestar/params";
import {allForks, phase0, ssz} from "@lodestar/types";
import {
  computeSigningRoot,
  computeStartSlotAtEpoch,
  ISignatureSet,
  SignatureSetType,
  verifySignatureSet,
} from "../util/index.js";
import {CachedBeaconStateAllForks} from "../types.js";

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
  const domain = state.config.getDomain(state.slot, DOMAIN_VOLUNTARY_EXIT, slot);

  return {
    type: SignatureSetType.single,
    pubkey: epochCtx.index2pubkey[signedVoluntaryExit.message.validatorIndex],
    signingRoot: computeSigningRoot(ssz.phase0.VoluntaryExit, signedVoluntaryExit.message, domain),
    signature: signedVoluntaryExit.signature,
  };
}

export function getVoluntaryExitsSignatureSets(
  state: CachedBeaconStateAllForks,
  signedBlock: allForks.SignedBeaconBlock
): ISignatureSet[] {
  return signedBlock.message.body.voluntaryExits.map((voluntaryExit) =>
    getVoluntaryExitSignatureSet(state, voluntaryExit)
  );
}
