import {allForks, altair, bellatrix} from "@chainsafe/lodestar-beacon-state-transition";
import {processParticipationRecordUpdates} from "@chainsafe/lodestar-beacon-state-transition/src/phase0/epoch/processParticipationRecordUpdates";
import {ForkName} from "@chainsafe/lodestar-params";
import {EpochProcessFn, epochProcessing} from "../allForks/epochProcessing";

/* eslint-disable @typescript-eslint/naming-convention */

// NOTE: Exact same code as for altair

epochProcessing(ForkName.bellatrix, {
  effective_balance_updates: allForks.processEffectiveBalanceUpdates,
  eth1_data_reset: allForks.processEth1DataReset,
  historical_roots_update: allForks.processHistoricalRootsUpdate,
  inactivity_updates: altair.processInactivityUpdates as EpochProcessFn,
  justification_and_finalization: allForks.processJustificationAndFinalization,
  participation_flag_updates: altair.processParticipationFlagUpdates as EpochProcessFn,
  participation_record_updates: (processParticipationRecordUpdates as unknown) as EpochProcessFn,
  randao_mixes_reset: allForks.processRandaoMixesReset,
  registry_updates: allForks.processRegistryUpdates,
  rewards_and_penalties: altair.processRewardsAndPenalties as EpochProcessFn,
  slashings: bellatrix.processSlashings as EpochProcessFn,
  slashings_reset: allForks.processSlashingsReset,
  sync_committee_updates: altair.processSyncCommitteeUpdates as EpochProcessFn,
});
