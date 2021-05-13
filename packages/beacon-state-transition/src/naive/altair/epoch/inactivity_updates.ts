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
  const inActivityLeak = isInInactivityLeak(config, (state as unknown) as phase0.BeaconState);
  for (const index of getEligibleValidatorIndices(config, (state as unknown) as phase0.BeaconState)) {
    if (unslashedParticipatingIndices.includes(index)) {
      if (state.inactivityScores[index] > 0) {
        state.inactivityScores[index] -= 1;
      }
    } else if (inActivityLeak) {
      state.inactivityScores[index] += Number(config.params.INACTIVITY_SCORE_BIAS);
    }
  }
}
