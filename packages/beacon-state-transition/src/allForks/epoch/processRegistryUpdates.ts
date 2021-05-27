import {allForks} from "@chainsafe/lodestar-types";
import {computeActivationExitEpoch} from "../../util";
import {IEpochProcess, CachedBeaconState} from "../util";

export function processRegistryUpdates(state: CachedBeaconState<allForks.BeaconState>, process: IEpochProcess): void {
  const {config, validators, epochCtx} = state;
  let exitEnd = process.exitQueueEnd;
  let endChurn = process.exitQueueEndChurn;
  // process ejections
  for (const index of process.indicesToEject) {
    // set validator exit epoch and withdrawable epoch
    validators.update(index, {
      exitEpoch: exitEnd,
      withdrawableEpoch: exitEnd + config.MIN_VALIDATOR_WITHDRAWABILITY_DELAY,
    });

    endChurn += 1;
    if (endChurn >= process.churnLimit) {
      endChurn = 0;
      exitEnd += 1;
    }
  }

  // set new activation eligibilities
  for (const index of process.indicesToSetActivationEligibility) {
    validators.update(index, {
      activationEligibilityEpoch: epochCtx.currentShuffling.epoch + 1,
    });
  }

  const finalityEpoch = state.finalizedCheckpoint.epoch;
  // dequeue validators for activation up to churn limit
  for (const index of process.indicesToMaybeActivate.slice(0, process.churnLimit)) {
    // placement in queue is finalized
    if (process.validators[index].activationEligibilityEpoch > finalityEpoch) {
      break; // remaining validators all have an activationEligibilityEpoch that is higher anyway, break early
    }
    validators.update(index, {
      activationEpoch: computeActivationExitEpoch(process.currentEpoch),
    });
  }
}
