import fs from "fs";
import {join} from "path";
import {expect} from "chai";
import {describeDirectorySpecTest} from "@chainsafe/lodestar-spec-test-util";
import {altair, allForks} from "@chainsafe/lodestar-beacon-state-transition";
import {TreeBacked, VectorType} from "@chainsafe/ssz";
import {
  ACTIVE_PRESET,
  TIMELY_HEAD_FLAG_INDEX,
  TIMELY_SOURCE_FLAG_INDEX,
  TIMELY_TARGET_FLAG_INDEX,
} from "@chainsafe/lodestar-params";
import {ssz} from "@chainsafe/lodestar-types";
import {SPEC_TEST_LOCATION} from "../../utils/specTestCases";
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
      const wrappedState = allForks.createCachedBeaconState<altair.BeaconState>(
        config,
        (testcase.pre as TreeBacked<altair.BeaconState>).clone()
      );
      const epochProcess = allForks.beforeProcessEpoch(wrappedState);
      return {
        head_deltas: altair.getFlagIndexDeltas(wrappedState, epochProcess, TIMELY_HEAD_FLAG_INDEX),
        source_deltas: altair.getFlagIndexDeltas(wrappedState, epochProcess, TIMELY_SOURCE_FLAG_INDEX),
        target_deltas: altair.getFlagIndexDeltas(wrappedState, epochProcess, TIMELY_TARGET_FLAG_INDEX),
        inactivity_penalty_deltas: altair.getInactivityPenaltyDeltas(wrappedState, epochProcess),
      };
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
      getExpected: (testCase) => ({
        head_deltas: testCase.head_deltas,
        source_deltas: testCase.source_deltas,
        target_deltas: testCase.target_deltas,
        inactivity_penalty_deltas: testCase.inactivity_penalty_deltas,
      }),
      expectFunc: (testCase, expected, actual) => {
        expect(actual).to.deep.equal(expected);
      },
    }
  );
}

interface RewardTestCase extends IBaseSpecTest {
  pre: altair.BeaconState;
  head_deltas: number[][];
  source_deltas: number[][];
  target_deltas: number[][];
  inactivity_penalty_deltas: number[][];
}

type Output = {
  head_deltas: number[][];
  source_deltas: number[][];
  target_deltas: number[][];
  inactivity_penalty_deltas: number[][];
};
