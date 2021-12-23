import {allForks, phase0} from "@chainsafe/lodestar-beacon-state-transition";
import {processParticipationRecordUpdates} from "@chainsafe/lodestar-beacon-state-transition/src/phase0/epoch/processParticipationRecordUpdates";
import {ForkName} from "@chainsafe/lodestar-params";
import {EpochProcessFn, epochProcessing} from "../allForks/epochProcessing";

/* eslint-disable @typescript-eslint/naming-convention */

epochProcessing(ForkName.phase0, {
  effective_balance_updates: allForks.processEffectiveBalanceUpdates,
  eth1_data_reset: allForks.processEth1DataReset,
  historical_roots_update: allForks.processHistoricalRootsUpdate,
  justification_and_finalization: allForks.processJustificationAndFinalization,
  participation_record_updates: (processParticipationRecordUpdates as unknown) as EpochProcessFn,
  randao_mixes_reset: allForks.processRandaoMixesReset,
  registry_updates: allForks.processRegistryUpdates,
  rewards_and_penalties: phase0.processRewardsAndPenalties as EpochProcessFn,
  slashings: phase0.processSlashings as EpochProcessFn,
  slashings_reset: allForks.processSlashingsReset,
});
