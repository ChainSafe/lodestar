import {phase0} from "@chainsafe/lodestar-types";
import {List} from "@chainsafe/ssz";
import {BeaconStateCachedPhase0} from "../../allForks/util";

/**
 * PERF: Should have zero cost. It just moves a rootNode from one key to another. Then it creates an empty tree on the
 * previous key
 */
export function processParticipationRecordUpdates(state: BeaconStateCachedPhase0): void {
  // rotate current/previous epoch attestations
  state.previousEpochAttestations = state.currentEpochAttestations;
  state.currentEpochAttestations = ([] as phase0.PendingAttestation[]) as List<phase0.PendingAttestation>;
}
