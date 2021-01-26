import {prepareEpochProcessState} from "../util";
import {processJustificationAndFinalization} from "./processJustificationAndFinalization";
import {processRewardsAndPenalties} from "./processRewardsAndPenalties";
import {processRegistryUpdates} from "./processRegistryUpdates";
import {processSlashings} from "./processSlashings";
import {processFinalUpdates} from "./processFinalUpdates";
import {processForkChanged} from "./processFork";
import {getAttestationDeltas} from "./getAttestationDeltas";
import {CachedBeaconState} from "../util/cachedBeaconState";

export {
  processJustificationAndFinalization,
  processRewardsAndPenalties,
  processRegistryUpdates,
  processSlashings,
  processFinalUpdates,
  processForkChanged,
  getAttestationDeltas,
};

export function processEpoch(cachedState: CachedBeaconState): void {
  const process = prepareEpochProcessState(cachedState);
  processJustificationAndFinalization(cachedState, process);
  processRewardsAndPenalties(cachedState, process);
  processRegistryUpdates(cachedState, process);
  processSlashings(cachedState, process);
  processFinalUpdates(cachedState, process);
  processForkChanged(cachedState, process);
}
