import {processRewardsAndPenalties} from "./processRewardsAndPenalties";
import {processSlashings} from "./processSlashings";
import {getAttestationDeltas} from "./getAttestationDeltas";
import {processParticipationRecordUpdates} from "./processParticipationRecordUpdates";
import {
  processJustificationAndFinalization,
  processRegistryUpdates,
  processEth1DataReset,
  processEffectiveBalanceUpdates,
  processSlashingsReset,
  processRandaoMixesReset,
  processHistoricalRootsUpdate,
} from "../../allForks/epoch";
import {CachedBeaconStatePhase0, EpochProcess} from "../../types";

export {processRewardsAndPenalties, processSlashings, getAttestationDeltas, processParticipationRecordUpdates};

export function processEpoch(state: CachedBeaconStatePhase0, epochProcess: EpochProcess): void {
  processJustificationAndFinalization(state, epochProcess);
  processRewardsAndPenalties(state, epochProcess);
  processRegistryUpdates(state, epochProcess);
  processSlashings(state, epochProcess);
  // inline processFinalUpdates() to follow altair and for clarity
  processEth1DataReset(state, epochProcess);
  processEffectiveBalanceUpdates(state, epochProcess);
  processSlashingsReset(state, epochProcess);
  processRandaoMixesReset(state, epochProcess);
  processHistoricalRootsUpdate(state, epochProcess);
  processParticipationRecordUpdates(state);
}
