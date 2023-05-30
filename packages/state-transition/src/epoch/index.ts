import {ForkSeq} from "@lodestar/params";
import {
  CachedBeaconStateAllForks,
  CachedBeaconStateCapella,
  CachedBeaconStateAltair,
  CachedBeaconStatePhase0,
  EpochTransitionCache,
} from "../types.js";
import {processEffectiveBalanceUpdates} from "./process_effective_balance_updates.js";
import {processEth1DataReset} from "./process_eth1_data_reset.js";
import {processHistoricalRootsUpdate} from "./process_historical_roots_update.js";
import {processHistoricalSummariesUpdate} from "./process_historical_summaries_update.js";
import {processInactivityUpdates} from "./process_inactivity_updates.js";
import {processJustificationAndFinalization} from "./process_justification_and_finalization.js";
import {processParticipationFlagUpdates} from "./process_participation_flag_updates.js";
import {processParticipationRecordUpdates} from "./process_participation_record_updates.js";
import {processRandaoMixesReset} from "./process_randao_mixes_reset.js";
import {processRegistryUpdates} from "./process_registry_updates.js";
import {processRewardsAndPenalties} from "./process_rewards_and_penalties.js";
import {processSlashings} from "./process_slashings.js";
import {processSlashingsReset} from "./process_slashings_reset.js";
import {processSyncCommitteeUpdates} from "./process_sync_committee_updates.js";

// For spec tests
export {getRewardsAndPenalties} from "./process_rewards_and_penalties.js";
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
  processHistoricalSummariesUpdate,
};

export {computeUnrealizedCheckpoints} from "./compute_unrealized_checkpoints.js";

export function processEpoch(fork: ForkSeq, state: CachedBeaconStateAllForks, cache: EpochTransitionCache): void {
  processJustificationAndFinalization(state, cache);
  if (fork >= ForkSeq.altair) {
    processInactivityUpdates(state as CachedBeaconStateAltair, cache);
  }
  processRewardsAndPenalties(state, cache);
  processRegistryUpdates(state, cache);
  processSlashings(state, cache);
  processEth1DataReset(state, cache);
  processEffectiveBalanceUpdates(state, cache);
  processSlashingsReset(state, cache);
  processRandaoMixesReset(state, cache);

  if (fork >= ForkSeq.capella) {
    processHistoricalSummariesUpdate(state as CachedBeaconStateCapella, cache);
  } else {
    processHistoricalRootsUpdate(state, cache);
  }

  if (fork === ForkSeq.phase0) {
    processParticipationRecordUpdates(state as CachedBeaconStatePhase0);
  } else {
    processParticipationFlagUpdates(state as CachedBeaconStateAltair);
    processSyncCommitteeUpdates(state as CachedBeaconStateAltair);
  }
}
