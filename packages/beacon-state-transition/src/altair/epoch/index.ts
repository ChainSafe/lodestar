import {allForks, altair} from "@chainsafe/lodestar-types";
import {prepareEpochProcessState, CachedBeaconState} from "../../allForks/util";
import {
  processJustificationAndFinalization,
  processRegistryUpdates,
  processEth1DataReset,
  processEffectiveBalanceUpdates,
  processSlashingsReset,
  processRandaoMixesReset,
  processHistoricalRootsUpdate,
} from "../../allForks/epoch";
import {processRewardsAndPenalties} from "./processRewardsAndPenalties";
import {processSlashings} from "./processSlashings";
import {processParticipationFlagUpdates} from "./processParticipationFlagUpdates";
import {processInactivityUpdates} from "./processInactivityUpdates";
import {processSyncCommitteeUpdates} from "./processSyncCommitteeUpdates";

export {
  processJustificationAndFinalization,
  processRewardsAndPenalties,
  processRegistryUpdates,
  processSlashings,
  processSyncCommitteeUpdates,
  processEffectiveBalanceUpdates,
};

export function processEpoch(state: CachedBeaconState<altair.BeaconState>): void {
  const process = prepareEpochProcessState(state);
  processJustificationAndFinalization(state as CachedBeaconState<allForks.BeaconState>, process);
  processInactivityUpdates(state, process);
  processRewardsAndPenalties(state, process);
  processRegistryUpdates(state as CachedBeaconState<allForks.BeaconState>, process);
  processSlashings(state, process);
  processEth1DataReset(state as CachedBeaconState<allForks.BeaconState>, process);
  processEffectiveBalanceUpdates(state as CachedBeaconState<allForks.BeaconState>, process);
  processSlashingsReset(state as CachedBeaconState<allForks.BeaconState>, process);
  processRandaoMixesReset(state as CachedBeaconState<allForks.BeaconState>, process);
  processHistoricalRootsUpdate(state as CachedBeaconState<allForks.BeaconState>, process);
  processParticipationFlagUpdates(state);
  processSyncCommitteeUpdates(state, process);
}
