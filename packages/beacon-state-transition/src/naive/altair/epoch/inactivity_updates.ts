import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {altair, phase0} from "@chainsafe/lodestar-types";
import {getEligibleValidatorIndices} from "../../phase0";
import {getPreviousEpoch, isInInactivityLeak} from "../../../util";
import {TIMELY_TARGET_FLAG_INDEX} from "../../../altair/constants";
import {getUnslashedParticipatingIndices} from "../../../altair/state_accessor";

export function processInactivityUpdates(config: IBeaconConfig, state: altair.BeaconState): void {
  const unslashedParticipatingIndices = getUnslashedParticipatingIndices(
    config,
    state,
    TIMELY_TARGET_FLAG_INDEX,
    getPreviousEpoch(config, state)
  );
  const {INACTIVITY_SCORE_BIAS, INACTIVITY_SCORE_RECOVERY_RATE} = config.params;
  const inActivityLeak = isInInactivityLeak(config, (state as unknown) as phase0.BeaconState);
  for (const index of getEligibleValidatorIndices(config, (state as unknown) as phase0.BeaconState)) {
    if (unslashedParticipatingIndices.includes(index)) {
      state.inactivityScores[index] -= Math.min(1, state.inactivityScores[index]);
    } else {
      state.inactivityScores[index] += Number(INACTIVITY_SCORE_BIAS);
    }

    if (!inActivityLeak) {
      state.inactivityScores[index] -= Math.min(Number(INACTIVITY_SCORE_RECOVERY_RATE), state.inactivityScores[index]);
    }
  }
}
