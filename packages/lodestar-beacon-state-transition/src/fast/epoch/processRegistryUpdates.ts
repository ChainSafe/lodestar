import {computeActivationExitEpoch} from "../../util";
import {CachedBeaconState} from "../util/cachedBeaconState";
import {IEpochProcess} from "../util/epochProcess";

export function processRegistryUpdates(cachedState: CachedBeaconState, process: IEpochProcess): void {
  const config = cachedState.config;
  let exitEnd = process.exitQueueEnd;
  let endChurn = process.exitQueueEndChurn;
  const {MIN_VALIDATOR_WITHDRAWABILITY_DELAY} = cachedState.config.params;
  // process ejections
  for (const index of process.indicesToEject) {
    // set validator exit epoch and withdrawable epoch
    cachedState.updateValidator(index, {
      exitEpoch: exitEnd,
      withdrawableEpoch: exitEnd + MIN_VALIDATOR_WITHDRAWABILITY_DELAY,
    });

    endChurn += 1;
    if (endChurn >= process.churnLimit) {
      endChurn = 0;
      exitEnd += 1;
    }
  }

  // set new activation eligibilities
  for (const index of process.indicesToSetActivationEligibility) {
    cachedState.updateValidator(index, {
      activationEligibilityEpoch: cachedState.currentShuffling.epoch + 1,
    });
  }

  const finalityEpoch = cachedState.finalizedCheckpoint.epoch;
  // dequeue validators for activation up to churn limit
  for (const index of process.indicesToMaybeActivate.slice(0, process.churnLimit)) {
    // placement in queue is finalized
    if (process.statuses[index].validator.activationEligibilityEpoch > finalityEpoch) {
      break; // remaining validators all have an activationEligibilityEpoch that is higher anyway, break early
    }
    cachedState.updateValidator(index, {
      activationEpoch: computeActivationExitEpoch(config, process.currentEpoch),
    });
  }
}
