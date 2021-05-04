import {allForks, phase0} from "@chainsafe/lodestar-types";
import {FAR_FUTURE_EPOCH} from "../../../constants";
import {isActiveValidator} from "../../../util";
import {CachedBeaconState} from "../../../fast/util";
import {initiateValidatorExit} from "../../../fast/block";
import {verifyVoluntaryExitSignature} from "../../../fast/signatureSets";

export function processVoluntaryExit(
  state: CachedBeaconState<phase0.BeaconState>,
  signedVoluntaryExit: phase0.SignedVoluntaryExit,
  verifySignature = true
): void {
  const {config, epochCtx} = state;
  const voluntaryExit = signedVoluntaryExit.message;
  const validator = state.validators[voluntaryExit.validatorIndex];
  const currentEpoch = epochCtx.currentShuffling.epoch;
  // verify the validator is active
  if (!isActiveValidator(validator, currentEpoch)) {
    throw new Error("VoluntaryExit validator is not active");
  }
  // verify exit has not been initiated
  if (validator.exitEpoch !== FAR_FUTURE_EPOCH) {
    throw new Error("VoluntaryExit validator exit has already been initiated: " + `exitEpoch=${validator.exitEpoch}`);
  }
  // exits must specify an epoch when they become valid; they are not valid before then
  if (!(currentEpoch >= voluntaryExit.epoch)) {
    throw new Error(
      "VoluntaryExit epoch is not yet valid: " + `epoch=${voluntaryExit.epoch} currentEpoch=${currentEpoch}`
    );
  }
  // verify the validator had been active long enough
  if (!(currentEpoch >= validator.activationEpoch + config.params.SHARD_COMMITTEE_PERIOD)) {
    throw new Error("VoluntaryExit validator has not been active for long enough");
  }

  // verify signature
  if (verifySignature) {
    if (!verifyVoluntaryExitSignature(state as CachedBeaconState<allForks.BeaconState>, signedVoluntaryExit)) {
      throw new Error("VoluntaryExit has an invalid signature");
    }
  }

  // initiate exit
  initiateValidatorExit(state as CachedBeaconState<allForks.BeaconState>, voluntaryExit.validatorIndex);
}
