import {CachedBeaconStatePhase0, CachedBeaconStateAllForks, EpochProcess} from "../../types";
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
import {getAttestationDeltas} from "./getAttestationDeltas";
import {processParticipationRecordUpdates} from "./processParticipationRecordUpdates";

export {processRewardsAndPenalties, processSlashings, getAttestationDeltas};

export function processEpoch(state: CachedBeaconStatePhase0, epochProcess: EpochProcess): void {
  processJustificationAndFinalization(state as CachedBeaconStateAllForks, epochProcess);
  processRewardsAndPenalties(state, epochProcess);
  processRegistryUpdates(state as CachedBeaconStateAllForks, epochProcess);
  processSlashings(state, epochProcess);
  // inline processFinalUpdates() to follow altair and for clarity
  processEth1DataReset(state as CachedBeaconStateAllForks, epochProcess);
  processEffectiveBalanceUpdates(state as CachedBeaconStateAllForks, epochProcess);
  processSlashingsReset(state as CachedBeaconStateAllForks, epochProcess);
  processRandaoMixesReset(state as CachedBeaconStateAllForks, epochProcess);
  processHistoricalRootsUpdate(state as CachedBeaconStateAllForks, epochProcess);
  processParticipationRecordUpdates(state);
}
