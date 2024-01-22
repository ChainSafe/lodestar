import path from "node:path";
import {expect} from "vitest";
import {VectorCompositeType} from "@chainsafe/ssz";
import {BeaconStateAllForks, beforeProcessEpoch} from "@lodestar/state-transition";
import {getRewardsAndPenalties} from "@lodestar/state-transition/epoch";
import {ssz} from "@lodestar/types";
import {ACTIVE_PRESET} from "@lodestar/params";
import {createCachedBeaconStateTest} from "../../utils/cachedBeaconState.js";
import {inputTypeSszTreeViewDU} from "../utils/expectEqualBeaconState.js";
import {getConfig} from "../../utils/config.js";
import {RunnerType, TestRunnerFn} from "../utils/types.js";
import {assertCorrectProgressiveBalances} from "../config.js";
import {ethereumConsensusSpecsTests} from "../specTestVersioning.js";
import {specTestIterator} from "../utils/specTestIterator.js";

/* eslint-disable @typescript-eslint/naming-convention */

const deltasType = new VectorCompositeType(ssz.phase0.Balances, 2);

const rewards: TestRunnerFn<RewardTestCase, Deltas> = (fork) => {
  return {
    testFunction: (testcase) => {
      const config = getConfig(fork);
      const wrappedState = createCachedBeaconStateTest(testcase.pre, config);
      const epochTransitionCache = beforeProcessEpoch(wrappedState, {assertCorrectProgressiveBalances});

      // To debug this test and get granular results you can tweak inputs to get more granular results
      //
      // TIMELY_HEAD_FLAG_INDEX -> FLAG_PREV_HEAD_ATTESTER_OR_UNSLASHED
      // TIMELY_SOURCE_FLAG_INDEX -> FLAG_PREV_SOURCE_ATTESTER_OR_UNSLASHED
      // TIMELY_TARGET_FLAG_INDEX -> FLAG_PREV_TARGET_ATTESTER_OR_UNSLASHED
      //
      // - To get head_deltas set TIMELY_SOURCE_FLAG_INDEX | TIMELY_TARGET_FLAG_INDEX to false
      // - To get source_deltas set TIMELY_HEAD_FLAG_INDEX | TIMELY_TARGET_FLAG_INDEX to false
      // - To get target_deltas set TIMELY_HEAD_FLAG_INDEX | TIMELY_SOURCE_FLAG_INDEX to false
      //   + set all inactivityScores to zero
      // - To get inactivity_penalty_deltas set TIMELY_HEAD_FLAG_INDEX | TIMELY_SOURCE_FLAG_INDEX to false
      //   + set PARTICIPATION_FLAG_WEIGHTS[TIMELY_TARGET_FLAG_INDEX] to zero
      return getRewardsAndPenalties(wrappedState, epochTransitionCache);
    },
    options: {
      inputTypes: inputTypeSszTreeViewDU,
      sszTypes: {
        pre: ssz[fork].BeaconState,
        source_deltas: deltasType,
        target_deltas: deltasType,
        head_deltas: deltasType,
        inclusion_delay_deltas: deltasType,
        inactivity_penalty_deltas: deltasType,
      },
      timeout: 100000000,
      getExpected: (testCase) =>
        sumDeltas([
          testCase.source_deltas,
          testCase.target_deltas,
          testCase.head_deltas,
          ...(testCase.inclusion_delay_deltas ? [testCase.inclusion_delay_deltas] : []),
          testCase.inactivity_penalty_deltas,
        ]),
      expectFunc: (testCase, expected, actual) => {
        expect(actual).to.deep.equal(expected);
      },
      // Do not manually skip tests here, do it in packages/beacon-node/test/spec/presets/index.test.ts
    },
  };
};

type Deltas = [number[], number[]];

type RewardTestCase = {
  meta?: any;
  pre: BeaconStateAllForks;
  source_deltas: Deltas;
  target_deltas: Deltas;
  head_deltas: Deltas;
  /** Only available in phase0 */
  inclusion_delay_deltas?: Deltas;
  inactivity_penalty_deltas: Deltas;
};

function sumDeltas(deltasArr: Deltas[]): Deltas {
  const totalDeltas: Deltas = [[], []];
  for (const deltas of deltasArr) {
    for (const n of [0, 1]) {
      for (let i = 0; i < deltas[n].length; i++) {
        totalDeltas[n][i] = (totalDeltas[n][i] ?? 0) + deltas[n][i];
      }
    }
  }
  return totalDeltas;
}

specTestIterator(path.join(ethereumConsensusSpecsTests.outputDir, "tests", ACTIVE_PRESET), {
  rewards: {type: RunnerType.default, fn: rewards},
});
