import {PersistentVector} from "@chainsafe/persistent-ts";
import {BeaconStateCachedAltair} from "../../types";

/**
 * Updates `state.previousEpochParticipation` with precalculated epoch participation. Creates a new empty tree for
 * `state.currentEpochParticipation`.
 *
 * PERF: Cost = 'proportional' $VALIDATOR_COUNT. Since it updates all of them at once, it will always recreate both
 * trees completely.
 */
export function processParticipationFlagUpdates(state: BeaconStateCachedAltair): void {
  state.previousEpochParticipation.updateAllStatus(state.currentEpochParticipation.persistent.vector);
  state.currentEpochParticipation.updateAllStatus(
    PersistentVector.from(
      Array.from({length: state.validators.length}, () => ({
        timelyHead: false,
        timelySource: false,
        timelyTarget: false,
      }))
    )
  );
}
