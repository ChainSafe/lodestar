import {CachedBeaconState, IEpochProcess, prepareEpochProcessState} from "../../allForks/util";
import {processJustificationAndFinalization, processRegistryUpdates} from "../../allForks/epoch";
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

export function processEpoch(state: CachedBeaconState<phase0.BeaconState>): IEpochProcess {
  const epochProcess = prepareEpochProcessState(state);
  processJustificationAndFinalization(state as CachedBeaconState<allForks.BeaconState>, epochProcess);
  processRewardsAndPenalties(state, epochProcess);
  processRegistryUpdates(state as CachedBeaconState<allForks.BeaconState>, epochProcess);
  processSlashings(state, epochProcess);
  processFinalUpdates(state, epochProcess);
  return epochProcess;
}
