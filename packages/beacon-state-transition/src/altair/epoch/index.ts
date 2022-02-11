import {CachedBeaconStateAltair, CachedBeaconStateAllForks, EpochProcess} from "../../types";
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

// For spec tests
export {getRewardsAndPenalties} from "./getRewardsAndPenalties";

export {
  processInactivityUpdates,
  processRewardsAndPenalties,
  processSlashings,
  processSyncCommitteeUpdates,
  processParticipationFlagUpdates,
};

export function processEpoch(state: CachedBeaconStateAltair, epochProcess: EpochProcess): void {
  processJustificationAndFinalization(state as CachedBeaconStateAllForks, epochProcess);
  processInactivityUpdates(state, epochProcess);
  processRewardsAndPenalties(state, epochProcess);
  processRegistryUpdates(state as CachedBeaconStateAllForks, epochProcess);
  processSlashings(state, epochProcess);
  processEth1DataReset(state as CachedBeaconStateAllForks, epochProcess);
  processEffectiveBalanceUpdates(state as CachedBeaconStateAllForks, epochProcess);
  processSlashingsReset(state as CachedBeaconStateAllForks, epochProcess);
  processRandaoMixesReset(state as CachedBeaconStateAllForks, epochProcess);
  processHistoricalRootsUpdate(state as CachedBeaconStateAllForks, epochProcess);
  processParticipationFlagUpdates(state);
  processSyncCommitteeUpdates(state);
}
