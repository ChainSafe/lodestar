import {allForks} from "@chainsafe/lodestar-types";
import {computeActivationExitEpoch} from "../../util";
import {IEpochProcess, CachedBeaconState} from "../util";

export function processRegistryUpdates(
  state: CachedBeaconState<allForks.BeaconState>,
  epochProcess: IEpochProcess
): void {
  const {config, validators, epochCtx} = state;
  let exitEnd = epochProcess.exitQueueEnd;
  let endChurn = epochProcess.exitQueueEndChurn;
  // process ejections
  for (const index of epochProcess.indicesToEject) {
    // set validator exit epoch and withdrawable epoch
    validators.update(index, {
      exitEpoch: exitEnd,
      withdrawableEpoch: exitEnd + config.MIN_VALIDATOR_WITHDRAWABILITY_DELAY,
    });

    endChurn += 1;
    if (endChurn >= epochProcess.churnLimit) {
      endChurn = 0;
      exitEnd += 1;
    }
  }

  // set new activation eligibilities
  for (const index of epochProcess.indicesEligibleForActivationQueue) {
    validators.update(index, {
      activationEligibilityEpoch: epochCtx.currentShuffling.epoch + 1,
    });
  }

  const finalityEpoch = state.finalizedCheckpoint.epoch;
  // dequeue validators for activation up to churn limit
  for (const index of epochProcess.indicesEligibleForActivation.slice(0, epochProcess.churnLimit)) {
    // placement in queue is finalized
    if (epochProcess.validators[index].activationEligibilityEpoch > finalityEpoch) {
      break; // remaining validators all have an activationEligibilityEpoch that is higher anyway, break early
    }
    validators.update(index, {
      activationEpoch: computeActivationExitEpoch(epochProcess.currentEpoch),
    });
  }
}
