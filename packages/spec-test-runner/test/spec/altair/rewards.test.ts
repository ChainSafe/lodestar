import fs from "fs";
import {join} from "path";
import {expect} from "chai";
import {describeDirectorySpecTest} from "@chainsafe/lodestar-spec-test-util";
import {altair, allForks} from "@chainsafe/lodestar-beacon-state-transition";
import {TreeBacked, VectorType} from "@chainsafe/ssz";
import {ACTIVE_PRESET} from "@chainsafe/lodestar-params";
import {ssz} from "@chainsafe/lodestar-types";
import {SPEC_TEST_LOCATION} from "../../specTestVersioning";
import {IBaseSpecTest} from "../type";
import {config} from "./util";
import {inputTypeSszTreeBacked} from "../util";

/* eslint-disable @typescript-eslint/naming-convention */

const Deltas = new VectorType<bigint[]>({
  elementType: ssz.altair.BeaconState.fields.balances,
  length: 2,
});

const rootDir = join(SPEC_TEST_LOCATION, `tests/${ACTIVE_PRESET}/altair/rewards`);
for (const testDir of fs.readdirSync(rootDir)) {
  describeDirectorySpecTest<RewardTestCase, Output>(
    `${ACTIVE_PRESET}/altair/rewards/${testDir}`,
    join(rootDir, `${testDir}/pyspec_tests`),
    (testcase) => {
      const state = allForks.createCachedBeaconState<altair.BeaconState>(
        config,
        (testcase.pre as TreeBacked<altair.BeaconState>).clone()
      );
      const epochProcess = allForks.beforeProcessEpoch(state);
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
      return altair.getRewardsPenaltiesDeltas(state, epochProcess);
    },
    {
      inputTypes: inputTypeSszTreeBacked,
      sszTypes: {
        pre: ssz.altair.BeaconState,
        head_deltas: Deltas,
        source_deltas: Deltas,
        target_deltas: Deltas,
        inactivity_penalty_deltas: Deltas,
      },
      getExpected: (testCase) =>
        sumDeltas([
          testCase.head_deltas,
          testCase.source_deltas,
          testCase.target_deltas,
          testCase.inactivity_penalty_deltas,
        ]),
      expectFunc: (testCase, expected, actual) => {
        expect(actual).to.deep.equal(expected);
      },
    }
  );
}

type Deltas = [number[], number[]];

interface RewardTestCase extends IBaseSpecTest {
  pre: altair.BeaconState;
  head_deltas: Deltas;
  source_deltas: Deltas;
  target_deltas: Deltas;
  inactivity_penalty_deltas: Deltas;
}

type Output = Deltas;

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
