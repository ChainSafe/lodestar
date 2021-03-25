import {prepareEpochProcessState, CachedBeaconState} from "../util";
import {processJustificationAndFinalization} from "./processJustificationAndFinalization";
import {processRewardsAndPenalties} from "./processRewardsAndPenalties";
import {processRegistryUpdates} from "./processRegistryUpdates";
import {processSlashings} from "./processSlashings";
import {processFinalUpdates} from "./processFinalUpdates";
import {getAttestationDeltas} from "./getAttestationDeltas";
import {phase0} from "@chainsafe/lodestar-types";

export {
  processJustificationAndFinalization,
  processRewardsAndPenalties,
  processRegistryUpdates,
  processSlashings,
  processFinalUpdates,
  getAttestationDeltas,
};

export function processEpoch(state: CachedBeaconState<phase0.BeaconState>): void {
  const process = prepareEpochProcessState(state);
  processJustificationAndFinalization(state, process);
  processRewardsAndPenalties(state, process);
  processRegistryUpdates(state, process);
  processSlashings(state, process);
  processFinalUpdates(state, process);
}
