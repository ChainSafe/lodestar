import {phase0} from "@chainsafe/lodestar-types";
import {PersistentVector} from "@chainsafe/persistent-ts";
import {List} from "@chainsafe/ssz";
import {CachedBeaconState} from "../../../fast";

export function processParticipationRecordUpdates(state: CachedBeaconState<phase0.BeaconState>): void {
  // rotate current/previous epoch attestations
  state.previousEpochAttestations = state.currentEpochAttestations;
  state.currentEpochAttestations = ([] as phase0.PendingAttestation[]) as List<phase0.PendingAttestation>;
  // rotate participation caches
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
