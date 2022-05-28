import {
  CachedBeaconStateAllForks,
  EpochProcess,
  BeaconStateAllForks,
  beforeProcessEpoch,
  allForks,
  phase0,
  altair,
  bellatrix,
} from "@chainsafe/lodestar-beacon-state-transition";
import {ssz} from "@chainsafe/lodestar-types";
import {ForkName} from "@chainsafe/lodestar-params";
import {createCachedBeaconStateTest} from "../../utils/cachedBeaconState.js";
import {expectEqualBeaconState, inputTypeSszTreeViewDU} from "../utils/expectEqualBeaconState.js";
import {getConfig} from "../utils/getConfig.js";
import {TestRunnerFn} from "../utils/types.js";

export type EpochProcessFn = (state: CachedBeaconStateAllForks, epochProcess: EpochProcess) => void;

/* eslint-disable @typescript-eslint/naming-convention */

const epochProcessFnByFork: Record<ForkName, Record<string, EpochProcessFn>> = {
  [ForkName.phase0]: {
    effective_balance_updates: allForks.processEffectiveBalanceUpdates,
    eth1_data_reset: allForks.processEth1DataReset,
    historical_roots_update: allForks.processHistoricalRootsUpdate,
    justification_and_finalization: allForks.processJustificationAndFinalization,
    participation_record_updates: phase0.processParticipationRecordUpdates as EpochProcessFn,
    randao_mixes_reset: allForks.processRandaoMixesReset,
    registry_updates: allForks.processRegistryUpdates,
    rewards_and_penalties: phase0.processRewardsAndPenalties as EpochProcessFn,
    slashings: phase0.processSlashings as EpochProcessFn,
    slashings_reset: allForks.processSlashingsReset,
  },

  [ForkName.altair]: {
    effective_balance_updates: allForks.processEffectiveBalanceUpdates,
    eth1_data_reset: allForks.processEth1DataReset,
    historical_roots_update: allForks.processHistoricalRootsUpdate,
    inactivity_updates: altair.processInactivityUpdates as EpochProcessFn,
    justification_and_finalization: allForks.processJustificationAndFinalization,
    participation_flag_updates: altair.processParticipationFlagUpdates as EpochProcessFn,
    participation_record_updates: phase0.processParticipationRecordUpdates as EpochProcessFn,
    randao_mixes_reset: allForks.processRandaoMixesReset,
    registry_updates: allForks.processRegistryUpdates,
    rewards_and_penalties: altair.processRewardsAndPenalties as EpochProcessFn,
    slashings: altair.processSlashings as EpochProcessFn,
    slashings_reset: allForks.processSlashingsReset,
    sync_committee_updates: altair.processSyncCommitteeUpdates as EpochProcessFn,
  },

  [ForkName.bellatrix]: {
    effective_balance_updates: allForks.processEffectiveBalanceUpdates,
    eth1_data_reset: allForks.processEth1DataReset,
    historical_roots_update: allForks.processHistoricalRootsUpdate,
    inactivity_updates: altair.processInactivityUpdates as EpochProcessFn,
    justification_and_finalization: allForks.processJustificationAndFinalization,
    participation_flag_updates: altair.processParticipationFlagUpdates as EpochProcessFn,
    participation_record_updates: phase0.processParticipationRecordUpdates as EpochProcessFn,
    randao_mixes_reset: allForks.processRandaoMixesReset,
    registry_updates: allForks.processRegistryUpdates,
    rewards_and_penalties: altair.processRewardsAndPenalties as EpochProcessFn,
    slashings: bellatrix.processSlashings as EpochProcessFn,
    slashings_reset: allForks.processSlashingsReset,
    sync_committee_updates: altair.processSyncCommitteeUpdates as EpochProcessFn,
  },
};

/**
 * https://github.com/ethereum/consensus-specs/blob/dev/tests/formats/epoch_processing/README.md
 */
type EpochProcessingTestCase = {
  meta?: {bls_setting?: bigint};
  pre: BeaconStateAllForks;
  post: BeaconStateAllForks;
};

/**
 * @param fork
 * @param epochProcessFns Describe with which function to run each directory of tests
 */
export const epochProcessing: TestRunnerFn<EpochProcessingTestCase, BeaconStateAllForks> = (fork, testName) => {
  const config = getConfig(fork);
  const epochProcessFns = epochProcessFnByFork[fork];

  const epochProcessFn = epochProcessFns[testName];
  if (epochProcessFn === undefined) {
    throw Error(`No epochProcessFn for ${testName}`);
  }

  return {
    testFunction: (testcase) => {
      const stateTB = testcase.pre.clone();
      const state = createCachedBeaconStateTest(stateTB, config);

      const epochProcess = beforeProcessEpoch(state);
      epochProcessFn(state, epochProcess);
      state.commit();

      return state;
    },
    options: {
      inputTypes: inputTypeSszTreeViewDU,
      sszTypes: {
        pre: ssz[fork].BeaconState,
        post: ssz[fork].BeaconState,
      },
      getExpected: (testCase) => testCase.post,
      expectFunc: (testCase, expected, actual) => {
        expectEqualBeaconState(fork, expected, actual);
      },
    },
  };
};
