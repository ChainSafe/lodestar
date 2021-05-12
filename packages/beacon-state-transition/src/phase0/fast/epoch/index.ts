import {CachedBeaconState, prepareEpochProcessState} from "../../../fast/util";
import {processJustificationAndFinalization, processRegistryUpdates} from "../../../fast/epoch";
import {processRewardsAndPenalties} from "./processRewardsAndPenalties";
import {processSlashings} from "./processSlashings";
import {processFinalUpdates} from "./processFinalUpdates";
import {getAttestationDeltas} from "./getAttestationDeltas";
import {allForks, phase0} from "@chainsafe/lodestar-types";

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
  processJustificationAndFinalization(state as CachedBeaconState<allForks.BeaconState>, process);
  processRewardsAndPenalties(state, process);
  processRegistryUpdates(state as CachedBeaconState<allForks.BeaconState>, process);
  processSlashings(state, process);
  processFinalUpdates(state, process);
}
