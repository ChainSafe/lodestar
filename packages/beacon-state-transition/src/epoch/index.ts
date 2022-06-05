import {ForkSeq} from "@chainsafe/lodestar-params";
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

export * from "./processEffectiveBalanceUpdates.js";
export * from "./processEth1DataReset.js";
export * from "./processHistoricalRootsUpdate.js";
export * from "./processRandaoMixesReset.js";
export * from "./processSlashingsReset.js";
export * from "./processJustificationAndFinalization.js";
export * from "./processRegistryUpdates.js";

export function processEpoch(fork: ForkSeq, state: CachedBeaconStateAllForks, epochProcess: EpochProcess): void {
  processJustificationAndFinalization(state, epochProcess);
  if (fork >= ForkSeq.altair) {
    processInactivityUpdates(state as CachedBeaconStateAltair, epochProcess);
  }
  processRewardsAndPenalties(fork, state, epochProcess);
  processRegistryUpdates(state, epochProcess);
  processSlashings(fork, state, epochProcess);
  processEth1DataReset(state, epochProcess);
  processEffectiveBalanceUpdates(state, epochProcess);
  processSlashingsReset(state, epochProcess);
  processRandaoMixesReset(state, epochProcess);
  processHistoricalRootsUpdate(state, epochProcess);
  if (fork === ForkSeq.phase0) {
    processParticipationRecordUpdates(state as CachedBeaconStatePhase0);
  } else {
    processParticipationFlagUpdates(state as CachedBeaconStateAltair);
    processSyncCommitteeUpdates(state as CachedBeaconStateAltair);
  }
}
