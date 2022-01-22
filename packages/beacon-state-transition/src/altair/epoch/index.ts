import {BeaconStateCachedAltair, BeaconStateCachedAllForks, IEpochProcess} from "../../allForks/util";
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
export {getRewardsPenaltiesDeltas} from "./balance";

export {
  processInactivityUpdates,
  processRewardsAndPenalties,
  processSlashings,
  processSyncCommitteeUpdates,
  processParticipationFlagUpdates,
};

export function processEpoch(state: BeaconStateCachedAltair, epochProcess: IEpochProcess): void {
  processJustificationAndFinalization(state as BeaconStateCachedAllForks, epochProcess);
  processInactivityUpdates(state, epochProcess);
  processRewardsAndPenalties(state, epochProcess);
  processRegistryUpdates(state as BeaconStateCachedAllForks, epochProcess);
  processSlashings(state, epochProcess);
  processEth1DataReset(state as BeaconStateCachedAllForks, epochProcess);
  processEffectiveBalanceUpdates(state as BeaconStateCachedAllForks, epochProcess);
  processSlashingsReset(state as BeaconStateCachedAllForks, epochProcess);
  processRandaoMixesReset(state as BeaconStateCachedAllForks, epochProcess);
  processHistoricalRootsUpdate(state as BeaconStateCachedAllForks, epochProcess);
  processParticipationFlagUpdates(state);
  processSyncCommitteeUpdates(state, epochProcess);
}
