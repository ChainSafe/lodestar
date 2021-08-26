import {allForks, altair} from "@chainsafe/lodestar-types";
import {CachedBeaconState, IEpochProcess} from "../../allForks/util";
import {
  processJustificationAndFinalization,
  processRegistryUpdates,
  processEth1DataReset,
  processEffectiveBalanceUpdates,
  processSlashingsReset,
  processRandaoMixesReset,
  processHistoricalRootsUpdate,
} from "../../allForks/epoch";
import {processInactivityUpdates} from "./processInactivityUpdates";
import {processRewardsAndPenalties} from "./processRewardsAndPenalties";
import {processSlashings} from "./processSlashings";
import {processParticipationFlagUpdates} from "./processParticipationFlagUpdates";
import {processSyncCommitteeUpdates} from "./processSyncCommitteeUpdates";

// For spec tests
export {getRewardsPenaltiesDeltas, getFlagIndexDeltas, getInactivityPenaltyDeltas} from "./balance";

export {
  processInactivityUpdates,
  processRewardsAndPenalties,
  processSlashings,
  processSyncCommitteeUpdates,
  processParticipationFlagUpdates,
};

export function processEpoch(state: CachedBeaconState<altair.BeaconState>, epochProcess: IEpochProcess): void {
  processJustificationAndFinalization(state as CachedBeaconState<allForks.BeaconState>, epochProcess);
  processInactivityUpdates(state, epochProcess);
  processRewardsAndPenalties(state, epochProcess);
  processRegistryUpdates(state as CachedBeaconState<allForks.BeaconState>, epochProcess);
  processSlashings(state, epochProcess);
  processEth1DataReset(state as CachedBeaconState<allForks.BeaconState>, epochProcess);
  processEffectiveBalanceUpdates(state as CachedBeaconState<allForks.BeaconState>, epochProcess);
  processSlashingsReset(state as CachedBeaconState<allForks.BeaconState>, epochProcess);
  processRandaoMixesReset(state as CachedBeaconState<allForks.BeaconState>, epochProcess);
  processHistoricalRootsUpdate(state as CachedBeaconState<allForks.BeaconState>, epochProcess);
  processParticipationFlagUpdates(state);
  processSyncCommitteeUpdates(state, epochProcess);
}
