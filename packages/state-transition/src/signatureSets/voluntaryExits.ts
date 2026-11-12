import {BeaconConfig} from "@lodestar/config";
import {phase0, ssz} from "@lodestar/types";
import {IBeaconStateView} from "../stateView/interface.js";
import {
  ISignatureSet,
  SignatureSetType,
  computeSigningRoot,
  computeStartSlotAtEpoch,
  verifySignatureSet,
} from "../util/index.js";

export function verifyVoluntaryExitSignature(
  config: BeaconConfig,
  state: IBeaconStateView,
  signedVoluntaryExit: phase0.SignedVoluntaryExit
): boolean {
  return verifySignatureSet(getVoluntaryExitSignatureSet(config, state, signedVoluntaryExit));
}

/**
 * Extract signatures to allow validating all block signatures at once
 */
export function getVoluntaryExitSignatureSet(
  config: BeaconConfig,
  state: IBeaconStateView,
  signedVoluntaryExit: phase0.SignedVoluntaryExit
): ISignatureSet {
  const messageSlot = computeStartSlotAtEpoch(signedVoluntaryExit.message.epoch);
  const domain = config.getDomainForVoluntaryExit(state.slot, messageSlot);

  return {
    type: SignatureSetType.indexed,
    index: signedVoluntaryExit.message.validatorIndex,
    signingRoot: computeSigningRoot(ssz.phase0.VoluntaryExit, signedVoluntaryExit.message, domain),
    signature: signedVoluntaryExit.signature,
  };
}
