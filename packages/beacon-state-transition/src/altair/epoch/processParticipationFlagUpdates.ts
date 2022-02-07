import {PersistentVector} from "@chainsafe/persistent-ts";
import {newFilledArray} from "../../util/array";
import {CachedBeaconStateAltair} from "../../types";

/**
 * Updates `state.previousEpochParticipation` with precalculated epoch participation. Creates a new empty tree for
 * `state.currentEpochParticipation`.
 *
 * PERF: Cost = 'proportional' $VALIDATOR_COUNT. Since it updates all of them at once, it will always recreate both
 * trees completely.
 */
export function processParticipationFlagUpdates(state: CachedBeaconStateAltair): void {
  state.previousEpochParticipation.updateAllStatus(state.currentEpochParticipation.persistent.vector);
  state.currentEpochParticipation.updateAllStatus(PersistentVector.from(newFilledArray(state.validators.length, 0)));
}
