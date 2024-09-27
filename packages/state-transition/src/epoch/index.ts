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
  CachedBeaconStateElectra,
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
import {processPendingDeposits} from "./processPendingDeposits.js";
import {processPendingConsolidations} from "./processPendingConsolidations.js";

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
  processPendingDeposits,
  processPendingConsolidations,
};

export {computeUnrealizedCheckpoints} from "./computeUnrealizedCheckpoints.js";
const maxValidatorsPerStateSlashing = SLOTS_PER_EPOCH * MAX_ATTESTER_SLASHINGS * MAX_VALIDATORS_PER_COMMITTEE;
const maxSafeValidators = Math.floor(Number.MAX_SAFE_INTEGER / MAX_EFFECTIVE_BALANCE);

/**
 * Epoch transition steps tracked in metrics
 */
export enum EpochTransitionStep {
  beforeProcessEpoch = "beforeProcessEpoch",
  afterProcessEpoch = "afterProcessEpoch",
  processJustificationAndFinalization = "processJustificationAndFinalization",
  processInactivityUpdates = "processInactivityUpdates",
  processRegistryUpdates = "processRegistryUpdates",
  processSlashings = "processSlashings",
  processRewardsAndPenalties = "processRewardsAndPenalties",
  processEffectiveBalanceUpdates = "processEffectiveBalanceUpdates",
  processParticipationFlagUpdates = "processParticipationFlagUpdates",
  processSyncCommitteeUpdates = "processSyncCommitteeUpdates",
  processPendingDeposits = "processPendingDeposits",
  processPendingConsolidations = "processPendingConsolidations",
}

export function processEpoch(
  fork: ForkSeq,
  state: CachedBeaconStateAllForks,
  cache: EpochTransitionCache,
  metrics?: BeaconStateTransitionMetrics | null
): void {
  // state.slashings is initially a Gwei (BigInt) vector, however since Nov 2023 it's converted to UintNum64 (number) vector in the state transition because:
  //  - state.slashings[nextEpoch % EPOCHS_PER_SLASHINGS_VECTOR] is reset per epoch in processSlashingsReset()
  //  - max slashed validators per epoch is SLOTS_PER_EPOCH * MAX_ATTESTER_SLASHINGS * MAX_VALIDATORS_PER_COMMITTEE which is 32 * 2 * 2048 = 131072 on mainnet
  //  - with that and 32_000_000_000 MAX_EFFECTIVE_BALANCE or 2048_000_000_000 MAX_EFFECTIVE_BALANCE_ELECTRA, it still fits in a number given that Math.floor(Number.MAX_SAFE_INTEGER / 32_000_000_000) = 281474
  if (maxValidatorsPerStateSlashing > maxSafeValidators) {
    throw new Error("Lodestar does not support this network, parameters don't fit number value inside state.slashings");
  }

  {
    const timer = metrics?.epochTransitionStepTime.startTimer({
      step: EpochTransitionStep.processJustificationAndFinalization,
    });
    processJustificationAndFinalization(state, cache);
    timer?.();
  }

  if (fork >= ForkSeq.altair) {
    const timer = metrics?.epochTransitionStepTime.startTimer({step: EpochTransitionStep.processInactivityUpdates});
    processInactivityUpdates(state as CachedBeaconStateAltair, cache);
    timer?.();
  }

  // processRewardsAndPenalties() is 2nd step in the specs, we optimize to do it
  // after processSlashings() to update balances only once
  // processRewardsAndPenalties(state, cache);
  {
    const timer = metrics?.epochTransitionStepTime.startTimer({step: EpochTransitionStep.processRegistryUpdates});
    processRegistryUpdates(fork, state, cache);
    timer?.();
  }

  // accumulate slashing penalties and only update balances once in processRewardsAndPenalties()
  let slashingPenalties: number[];
  {
    const timer = metrics?.epochTransitionStepTime.startTimer({step: EpochTransitionStep.processSlashings});
    slashingPenalties = processSlashings(state, cache, false);
    timer?.();
  }

  {
    const timer = metrics?.epochTransitionStepTime.startTimer({step: EpochTransitionStep.processRewardsAndPenalties});
    processRewardsAndPenalties(state, cache, slashingPenalties);
    timer?.();
  }

  processEth1DataReset(state, cache);

  if (fork >= ForkSeq.electra) {
    const stateElectra = state as CachedBeaconStateElectra;
    {
      const timer = metrics?.epochTransitionStepTime.startTimer({
        step: EpochTransitionStep.processPendingDeposits,
      });
      processPendingDeposits(stateElectra, cache);
      timer?.();
    }

    {
      const timer = metrics?.epochTransitionStepTime.startTimer({
        step: EpochTransitionStep.processPendingConsolidations,
      });
      processPendingConsolidations(stateElectra, cache);
      timer?.();
    }
  }

  {
    const timer = metrics?.epochTransitionStepTime.startTimer({
      step: EpochTransitionStep.processEffectiveBalanceUpdates,
    });
    const numUpdate = processEffectiveBalanceUpdates(fork, state, cache);
    timer?.();
    metrics?.numEffectiveBalanceUpdates.set(numUpdate);
  }

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
    {
      const timer = metrics?.epochTransitionStepTime.startTimer({
        step: EpochTransitionStep.processParticipationFlagUpdates,
      });
      processParticipationFlagUpdates(state as CachedBeaconStateAltair);
      timer?.();
    }

    {
      const timer = metrics?.epochTransitionStepTime.startTimer({
        step: EpochTransitionStep.processSyncCommitteeUpdates,
      });
      processSyncCommitteeUpdates(fork, state as CachedBeaconStateAltair);
      timer?.();
    }
  }
}
