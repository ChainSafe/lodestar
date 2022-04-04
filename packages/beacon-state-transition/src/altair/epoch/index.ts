import {CachedBeaconStateAltair, EpochProcess} from "../../types";
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
  processJustificationAndFinalization(state, epochProcess);
  processInactivityUpdates(state, epochProcess);
  processRewardsAndPenalties(state, epochProcess);
  processRegistryUpdates(state, epochProcess);
  processSlashings(state, epochProcess);
  processEth1DataReset(state, epochProcess);
  processEffectiveBalanceUpdates(state, epochProcess);
  processSlashingsReset(state, epochProcess);
  processRandaoMixesReset(state, epochProcess);
  processHistoricalRootsUpdate(state, epochProcess);
  processParticipationFlagUpdates(state);
  processSyncCommitteeUpdates(state);
}
