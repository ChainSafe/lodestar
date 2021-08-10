import {allForks} from "@chainsafe/lodestar-types";
import {computeActivationExitEpoch} from "../../util";
import {initiateValidatorExit} from "../block";
import {IEpochProcess, CachedBeaconState} from "../util";

export function processRegistryUpdates(
  state: CachedBeaconState<allForks.BeaconState>,
  epochProcess: IEpochProcess
): void {
  const {validators, epochCtx} = state;

  // process ejections
  for (const index of epochProcess.indicesToEject) {
    // set validator exit epoch and withdrawable epoch
    // TODO: Figure out a way to quickly set properties on the validators tree
    initiateValidatorExit(state, index);
  }

  // set new activation eligibilities
  for (const index of epochProcess.indicesEligibleForActivationQueue) {
    validators.update(index, {
      activationEligibilityEpoch: epochCtx.currentShuffling.epoch + 1,
    });
  }

  const finalityEpoch = state.finalizedCheckpoint.epoch;
  // dequeue validators for activation up to churn limit
  for (const index of epochProcess.indicesEligibleForActivation.slice(0, epochCtx.churnLimit)) {
    // placement in queue is finalized
    if (epochProcess.validators[index].activationEligibilityEpoch > finalityEpoch) {
      break; // remaining validators all have an activationEligibilityEpoch that is higher anyway, break early
    }
    validators.update(index, {
      activationEpoch: computeActivationExitEpoch(epochProcess.currentEpoch),
    });
  }
}
