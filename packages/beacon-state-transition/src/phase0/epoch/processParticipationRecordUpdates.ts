import {ssz} from "@chainsafe/lodestar-types";
import {CachedBeaconStatePhase0} from "../../types.js";

/**
 * PERF: Should have zero cost. It just moves a rootNode from one key to another. Then it creates an empty tree on the
 * previous key
 */
export function processParticipationRecordUpdates(state: CachedBeaconStatePhase0): void {
  // rotate current/previous epoch attestations
  state.previousEpochAttestations = state.currentEpochAttestations;

  // Reset list to empty
  state.currentEpochAttestations = ssz.phase0.EpochAttestations.defaultViewDU();
}
