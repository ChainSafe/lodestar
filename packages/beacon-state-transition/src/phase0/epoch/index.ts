import {CachedBeaconStatePhase0, EpochProcess} from "../../types.js";
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
import {getAttestationDeltas} from "./getAttestationDeltas.js";
import {processParticipationRecordUpdates} from "./processParticipationRecordUpdates.js";

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
