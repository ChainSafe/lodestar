import {CachedBeaconStateAltair, EpochProcess} from "../../types.js";
import {
  processJustificationAndFinalization,
  processRegistryUpdates,
  processEth1DataReset,
  processEffectiveBalanceUpdates,
  processSlashingsReset,
  processRandaoMixesReset,
  processHistoricalRootsUpdate,
} from "../../allForks/epoch/index.js";
import {processRewardsAndPenalties} from "./processRewardsAndPenalties.js";
import {processSlashings} from "./processSlashings.js";
import {processParticipationFlagUpdates} from "./processParticipationFlagUpdates.js";
import {processInactivityUpdates} from "./processInactivityUpdates.js";
import {processSyncCommitteeUpdates} from "./processSyncCommitteeUpdates.js";

// For spec tests
export {getRewardsAndPenalties} from "./getRewardsAndPenalties.js";

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
