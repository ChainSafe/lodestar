import {ssz} from "@chainsafe/lodestar-types";
import {newZeroedArray} from "../../util";
import {CachedBeaconStateAltair} from "../../types";

/**
 * Updates `state.previousEpochParticipation` with precalculated epoch participation. Creates a new empty tree for
 * `state.currentEpochParticipation`.
 *
 * PERF: Cost = 'proportional' $VALIDATOR_COUNT. Since it updates all of them at once, it will always recreate both
 * trees completely.
 */
export function processParticipationFlagUpdates(state: CachedBeaconStateAltair): void {
  // Set view and tree from currentEpochParticipation to previousEpochParticipation
  state.previousEpochParticipation = state.currentEpochParticipation;

  // Wipe currentEpochParticipation with an empty value
  const currentEpochParticipationArr = newZeroedArray(state.currentEpochParticipation.length);
  // TODO: Benchmark the cost of transforming to .toViewDU()
  state.currentEpochParticipation = ssz.altair.EpochParticipation.toViewDU(currentEpochParticipationArr);
}
