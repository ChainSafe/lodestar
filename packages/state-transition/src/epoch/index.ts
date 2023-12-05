import {
  ForkSeq,
  MAX_ATTESTER_SLASHINGS,
  MAX_EFFECTIVE_BALANCE,
  MAX_VALIDATORS_PER_COMMITTEE,
  SLOTS_PER_EPOCH,
} from "@lodestar/params";
import {
  CachedBeaconStateAllForks,
  CachedBeaconStateCapella,
  CachedBeaconStateAltair,
  CachedBeaconStatePhase0,
  EpochTransitionCache,
} from "../types.js";
import {BeaconStateTransitionMetrics} from "../metrics.js";
import {processEffectiveBalanceUpdates} from "./processEffectiveBalanceUpdates.js";
import {processEth1DataReset} from "./processEth1DataReset.js";
import {processHistoricalRootsUpdate} from "./processHistoricalRootsUpdate.js";
import {processHistoricalSummariesUpdate} from "./processHistoricalSummariesUpdate.js";
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

// For spec tests
export {getRewardsAndPenalties} from "./processRewardsAndPenalties.js";
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

export {computeUnrealizedCheckpoints} from "./computeUnrealizedCheckpoints.js";
const maxValidatorsPerStateSlashing = SLOTS_PER_EPOCH * MAX_ATTESTER_SLASHINGS * MAX_VALIDATORS_PER_COMMITTEE;
const maxSafeValidators = Math.floor(Number.MAX_SAFE_INTEGER / MAX_EFFECTIVE_BALANCE);

export function processEpoch(
  fork: ForkSeq,
  state: CachedBeaconStateAllForks,
  cache: EpochTransitionCache,
  metrics?: BeaconStateTransitionMetrics | null
): void {
  // state.slashings is initially a Gwei (BigInt) vector, however since Nov 2023 it's converted to UintNum64 (number) vector in the state transition because:
  //  - state.slashings[nextEpoch % EPOCHS_PER_SLASHINGS_VECTOR] is reset per epoch in processSlashingsReset()
  //  - max slashed validators per epoch is SLOTS_PER_EPOCH * MAX_ATTESTER_SLASHINGS * MAX_VALIDATORS_PER_COMMITTEE which is 32 * 2 * 2048 = 131072 on mainnet
  //  - with that and 32_000_000_000 MAX_EFFECTIVE_BALANCE, it still fits in a number given that Math.floor(Number.MAX_SAFE_INTEGER / 32_000_000_000) = 281474
  if (maxValidatorsPerStateSlashing > maxSafeValidators) {
    throw new Error("Lodestar does not support this network, parameters don't fit number value inside state.slashings");
  }

  let timer = metrics?.epochTransitionJustificationAndFinalizationTime.startTimer();
  processJustificationAndFinalization(state, cache);
  timer?.();
  if (fork >= ForkSeq.altair) {
    timer = metrics?.epochTransitionInactivityUpdatesTime.startTimer();
    processInactivityUpdates(state as CachedBeaconStateAltair, cache);
    timer?.();
  }
  // processRewardsAndPenalties() is 2nd step in the specs, we optimize to do it
  // after processSlashings() to update balances only once
  // processRewardsAndPenalties(state, cache);
  timer = metrics?.epochTransitionRegistryUpdatesTime.startTimer();
  processRegistryUpdates(state, cache);
  timer?.();
  // accumulate slashing penalties and only update balances once in processRewardsAndPenalties()
  timer = metrics?.epochTransitionSlashingsTime.startTimer();
  const slashingPenalties = processSlashings(state, cache, false);
  timer?.();
  timer = metrics?.epochTransitionRewardsAndPenaltiesTime.startTimer();
  processRewardsAndPenalties(state, cache, slashingPenalties);
  timer?.();
  processEth1DataReset(state, cache);
  timer = metrics?.epochTransitionEffectiveBalanceUpdatesTime.startTimer();
  processEffectiveBalanceUpdates(state, cache);
  timer?.();
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
    timer = metrics?.epochTransitionParticipationFlagUpdatesTime.startTimer();
    processParticipationFlagUpdates(state as CachedBeaconStateAltair);
    timer?.();
    timer = metrics?.epochTransitionSyncCommitteeUpdatesTime.startTimer();
    processSyncCommitteeUpdates(state as CachedBeaconStateAltair);
    timer?.();
  }
}
