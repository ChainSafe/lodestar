import path from "node:path";
import {expect} from "vitest";
import {
  CachedBeaconStateAllForks,
  EpochTransitionCache,
  BeaconStateAllForks,
  beforeProcessEpoch,
} from "@lodestar/state-transition";
import * as epochFns from "@lodestar/state-transition/epoch";
import {ssz} from "@lodestar/types";
import {ACTIVE_PRESET} from "@lodestar/params";
import {createCachedBeaconStateTest} from "../../utils/cachedBeaconState.js";
import {expectEqualBeaconState, inputTypeSszTreeViewDU} from "../utils/expectEqualBeaconState.js";
import {getConfig} from "../../utils/config.js";
import {RunnerType, TestRunnerFn} from "../utils/types.js";
import {assertCorrectProgressiveBalances} from "../config.js";
import {ethereumConsensusSpecsTests} from "../specTestVersioning.js";
import {specTestIterator} from "../utils/specTestIterator.js";

export type EpochTransitionFn = (state: CachedBeaconStateAllForks, epochTransitionCache: EpochTransitionCache) => void;

/* eslint-disable @typescript-eslint/naming-convention */

const epochTransitionFns: Record<string, EpochTransitionFn> = {
  effective_balance_updates: epochFns.processEffectiveBalanceUpdates,
  eth1_data_reset: epochFns.processEth1DataReset,
  historical_roots_update: epochFns.processHistoricalRootsUpdate,
  inactivity_updates: epochFns.processInactivityUpdates as EpochTransitionFn,
  justification_and_finalization: epochFns.processJustificationAndFinalization,
  participation_flag_updates: epochFns.processParticipationFlagUpdates as EpochTransitionFn,
  participation_record_updates: epochFns.processParticipationRecordUpdates as EpochTransitionFn,
  randao_mixes_reset: epochFns.processRandaoMixesReset,
  registry_updates: epochFns.processRegistryUpdates,
  rewards_and_penalties: epochFns.processRewardsAndPenalties,
  slashings: epochFns.processSlashings,
  slashings_reset: epochFns.processSlashingsReset,
  sync_committee_updates: epochFns.processSyncCommitteeUpdates as EpochTransitionFn,
  historical_summaries_update: epochFns.processHistoricalSummariesUpdate as EpochTransitionFn,
};

/**
 * https://github.com/ethereum/consensus-specs/blob/dev/tests/formats/epoch_processing/README.md
 */
type EpochTransitionCacheingTestCase = {
  meta?: {bls_setting?: bigint};
  pre: BeaconStateAllForks;
  post: BeaconStateAllForks;
};

/**
 * @param fork
 * @param epochTransitionFns Describe with which function to run each directory of tests
 */
const epochProcessing =
  (skipTestNames?: string[]): TestRunnerFn<EpochTransitionCacheingTestCase, BeaconStateAllForks> =>
  (fork, testName) => {
    const config = getConfig(fork);

    const epochTransitionFn = epochTransitionFns[testName];
    if (epochTransitionFn === undefined) {
      throw Error(`No epochTransitionFn for ${testName}`);
    }

    return {
      testFunction: (testcase) => {
        const stateTB = testcase.pre.clone();
        const state = createCachedBeaconStateTest(stateTB, config);

        const epochTransitionCache = beforeProcessEpoch(state, {assertCorrectProgressiveBalances});

        if (testcase.post === undefined) {
          // If post.ssz_snappy is not value, the sub-transition processing is aborted
          // https://github.com/ethereum/consensus-specs/blob/dev/tests/formats/epoch_processing/README.md#postssz_snappy
          expect(() => epochTransitionFn(state, epochTransitionCache)).to.throw();
        } else {
          epochTransitionFn(state, epochTransitionCache);
        }

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
        // Do not manually skip tests here, do it in packages/beacon-node/test/spec/presets/index.test.ts
        shouldSkip: (_testcase, name, _index) =>
          skipTestNames !== undefined && skipTestNames.some((skipTestName) => name.includes(skipTestName)),
      },
    };
  };

specTestIterator(path.join(ethereumConsensusSpecsTests.outputDir, "tests", ACTIVE_PRESET), {
  epoch_processing: {
    type: RunnerType.default,
    fn: epochProcessing([
      // TODO: invalid_large_withdrawable_epoch asserts an overflow on a u64 for its exit epoch.
      // Currently unable to reproduce in Lodestar, skipping for now
      // https://github.com/ethereum/consensus-specs/blob/3212c419f6335e80ed825b4855a071f76bef70c3/tests/core/pyspec/eth2spec/test/phase0/epoch_processing/test_process_registry_updates.py#L349
      "invalid_large_withdrawable_epoch",
    ]),
  },
});
