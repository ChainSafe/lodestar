import {BeaconState} from "@chainsafe/lodestar-types";

import {computeActivationExitEpoch} from "../../util";
import {EpochContext, IEpochProcess} from "../util";


export function processRegistryUpdates(
  epochCtx: EpochContext,
  process: IEpochProcess,
  state: BeaconState
): void {
  const config = epochCtx.config;
  let exitEnd = process.exitQueueEnd;
  let endChurn = process.exitQueueEndChurn;
  const {MIN_VALIDATOR_WITHDRAWABILITY_DELAY} = epochCtx.config.params;
  // process ejections
  process.indicesToEject.forEach((index) => {
    const validator = state.validators[index];

    // set validator exit epoch and withdrawable epoch
    validator.exitEpoch = exitEnd;
    validator.withdrawableEpoch = exitEnd + MIN_VALIDATOR_WITHDRAWABILITY_DELAY;

    endChurn += 1;
    if (endChurn >= process.churnLimit) {
      endChurn = 0;
      exitEnd += 1;
    }
  });

  // set new activation eligibilities
  process.indicesToSetActivationEligibility.forEach((index) => {
    state.validators[index].activationEligibilityEpoch = epochCtx.currentShuffling.epoch + 1;
  });

  const finalityEpoch = state.finalizedCheckpoint.epoch;
  // dequeue validators for activation up to churn limit
  for (const index of process.indicesToMaybeActivate.slice(0, process.churnLimit)) {
    // placement in queue is finalized
    if (process.statuses[index].validator.activationEligibilityEpoch > finalityEpoch) {
      break; // remaining validators all have an activationEligibilityEpoch that is higher anyway, break early
    }
    state.validators[index].activationEpoch = computeActivationExitEpoch(config, process.currentEpoch);
  }
}
