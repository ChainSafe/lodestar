import {altair} from "@chainsafe/lodestar-types";
import {PersistentVector} from "@chainsafe/persistent-ts";
import {CachedBeaconState} from "../../allForks/util";

export function processParticipationFlagUpdates(state: CachedBeaconState<altair.BeaconState>): void {
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
