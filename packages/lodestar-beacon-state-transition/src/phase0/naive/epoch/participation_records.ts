import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {phase0} from "@chainsafe/lodestar-types";
import {List} from "@chainsafe/ssz";

export function processParticipationRecordUpdates(config: IBeaconConfig, state: phase0.BeaconState): void {
  // Rotate current/previous epoch attestations
  state.previousEpochAttestations = state.currentEpochAttestations;
  state.currentEpochAttestations = ([] as phase0.PendingAttestation[]) as List<phase0.PendingAttestation>;
}
