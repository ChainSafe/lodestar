import {
  CachedBeaconStateAllForks,
  EpochProcess,
  BeaconStateAllForks,
  beforeProcessEpoch,
} from "@lodestar/state-transition";
import * as epochFns from "@lodestar/state-transition/epoch";
import {ssz} from "@lodestar/types";
import {createCachedBeaconStateTest} from "../../utils/cachedBeaconState.js";
import {expectEqualBeaconState, inputTypeSszTreeViewDU} from "../utils/expectEqualBeaconState.js";
import {getConfig} from "../utils/getConfig.js";
import {TestRunnerFn} from "../utils/types.js";

export type EpochProcessFn = (state: CachedBeaconStateAllForks, epochProcess: EpochProcess) => void;

/* eslint-disable @typescript-eslint/naming-convention */

const epochProcessFns: Record<string, EpochProcessFn> = {
  effective_balance_updates: epochFns.processEffectiveBalanceUpdates,
  eth1_data_reset: epochFns.processEth1DataReset,
  historical_roots_update: epochFns.processHistoricalRootsUpdate,
  inactivity_updates: epochFns.processInactivityUpdates as EpochProcessFn,
  justification_and_finalization: epochFns.processJustificationAndFinalization,
  participation_flag_updates: epochFns.processParticipationFlagUpdates as EpochProcessFn,
  participation_record_updates: epochFns.processParticipationRecordUpdates as EpochProcessFn,
  randao_mixes_reset: epochFns.processRandaoMixesReset,
  registry_updates: epochFns.processRegistryUpdates,
  rewards_and_penalties: epochFns.processRewardsAndPenalties,
  slashings: epochFns.processSlashings,
  slashings_reset: epochFns.processSlashingsReset,
  sync_committee_updates: epochFns.processSyncCommitteeUpdates as EpochProcessFn,
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
