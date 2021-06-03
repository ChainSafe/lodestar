import {allForks, altair, phase0} from "@chainsafe/lodestar-types";
import {CachedBeaconState} from "../../allForks/util";
import {initiateValidatorExit} from "../../allForks/block";
import {assertValidVoluntaryExit} from "../../phase0/block/processVoluntaryExit";

export function processVoluntaryExit(
  state: CachedBeaconState<altair.BeaconState>,
  signedVoluntaryExit: phase0.SignedVoluntaryExit,
  verifySignature = true
): void {
  assertValidVoluntaryExit(state as CachedBeaconState<allForks.BeaconState>, signedVoluntaryExit, verifySignature);

  initiateValidatorExit(state as CachedBeaconState<allForks.BeaconState>, signedVoluntaryExit.message.validatorIndex);
}
