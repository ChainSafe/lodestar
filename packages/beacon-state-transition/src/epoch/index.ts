import {ForkSeq as epochFns} from "@chainsafe/lodestar-params";
import {CachedBeaconStateAllForks, CachedBeaconStateAltair, CachedBeaconStatePhase0, EpochProcess} from "../types.js";
import {processEffectiveBalanceUpdates} from "./processEffectiveBalanceUpdates.js";
import {processEth1DataReset} from "./processEth1DataReset.js";
import {processHistoricalRootsUpdate} from "./processHistoricalRootsUpdate.js";
import {processInactivityUpdates} from "./processInactivityUpdates.js";
import {processJustificationAndFinalization} from "./processJustificationAndFinalization.js";
import {processParticipationFlagUpdates} from "./processParticipationFlagUpdates.js";
import {processParticipationRecordUpdates} from "./processParticipationRecordUpdates.js";
import {processRandaoMixesReset} from "./processRandaoMixesReset.js";
import {processRegistryUpdates} from "./processRegistryUpdates.js";
import {processRewardsAndPenalties} from "./processRewardsAndPenalties.js";
import {processSlashings} from "./processSlashings.js";
import {processSlashingsReset} from "./processSlashingsReset.js";
import {processSyncCommitteeUpdates} from "./processSyncCommitteeUpdates.js";

export {
  processJustificationAndFinalization,
  processInactivityUpdates,
  processRewardsAndPenalties,
  processRegistryUpdates,
  processSlashings,
  processEth1DataReset,
  processEffectiveBalanceUpdates,
  processSlashingsReset,
  processRandaoMixesReset,
  processHistoricalRootsUpdate,
  processParticipationRecordUpdates,
  processParticipationFlagUpdates,
  processSyncCommitteeUpdates,
};

export function processEpoch(fork: epochFns, state: CachedBeaconStateAllForks, epochProcess: EpochProcess): void {
  processJustificationAndFinalization(state, epochProcess);
  if (fork >= epochFns.altair) {
    processInactivityUpdates(state as CachedBeaconStateAltair, epochProcess);
  }
  processRewardsAndPenalties(state, epochProcess);
  processRegistryUpdates(state, epochProcess);
  processSlashings(state, epochProcess);
  processEth1DataReset(state, epochProcess);
  processEffectiveBalanceUpdates(state, epochProcess);
  processSlashingsReset(state, epochProcess);
  processRandaoMixesReset(state, epochProcess);
  processHistoricalRootsUpdate(state, epochProcess);
  if (fork === epochFns.phase0) {
    processParticipationRecordUpdates(state as CachedBeaconStatePhase0);
  } else {
    processParticipationFlagUpdates(state as CachedBeaconStateAltair);
    processSyncCommitteeUpdates(state as CachedBeaconStateAltair);
  }
}
