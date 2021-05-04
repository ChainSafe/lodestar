import {join} from "path";
import {expect} from "chai";

import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util";
import {altair, CachedBeaconState, fast} from "@chainsafe/lodestar-beacon-state-transition";
import {allForks, altair as altairTypes} from "@chainsafe/lodestar-types";
import {SPEC_TEST_LOCATION} from "../../../../utils/specTestCases";
import {IAltairStateTestCase} from "../../stateTestCase";
import {params} from "@chainsafe/lodestar-params/minimal";
import {TreeBacked, VectorType} from "@chainsafe/ssz";
import {createIBeaconConfig} from "@chainsafe/lodestar-config";
import {getFlagIndexDeltas, getInactivityPenaltyDeltas} from "@chainsafe/lodestar-beacon-state-transition/lib/altair/fast/epoch/balance";
import {
  TIMELY_HEAD_FLAG_INDEX,
  TIMELY_HEAD_WEIGHT,
  TIMELY_SOURCE_FLAG_INDEX,
  TIMELY_SOURCE_WEIGHT,
  TIMELY_TARGET_FLAG_INDEX,
  TIMELY_TARGET_WEIGHT,
} from "@chainsafe/lodestar-beacon-state-transition/lib/altair/constants";

// eslint-disable-next-line @typescript-eslint/naming-convention
const config = createIBeaconConfig({...params, ALTAIR_FORK_SLOT: 0});

const Deltas = new VectorType<bigint[]>({
  elementType: config.types.altair.BeaconState.fields.balances,
  length: 2,
});

type RewardTestCase = {
  pre: altair.BeaconState;
  head_deltas: bigint[][];
  source_deltas: bigint[][];
  target_deltas: bigint[][];
  inactivity_penalty_deltas: bigint[][];
};

type Output = {
  head_deltas: bigint[][];
  source_deltas: bigint[][];
  target_deltas: bigint[][];
  inactivity_penalty_deltas: bigint[][];
};

describeDirectorySpecTest<RewardTestCase, Output>(
  "altair rewards basic minimal",
  join(SPEC_TEST_LOCATION, "tests/minimal/altair/rewards/basic/pyspec_tests"),
  (testcase) => {
    const wrappedState = fast.createCachedBeaconState<altair.BeaconState>(
      config,
      (testcase.pre as TreeBacked<altair.BeaconState>).clone()
    );
    const process = fast.prepareEpochProcessState(wrappedState);
    return {
      head_deltas: getFlagIndexDeltas(wrappedState, process, TIMELY_HEAD_FLAG_INDEX, TIMELY_HEAD_WEIGHT),
      source_deltas: getFlagIndexDeltas(wrappedState, process, TIMELY_SOURCE_FLAG_INDEX, TIMELY_SOURCE_WEIGHT),
      target_deltas: getFlagIndexDeltas(wrappedState, process, TIMELY_TARGET_FLAG_INDEX, TIMELY_TARGET_WEIGHT),
      inactivity_penalty_deltas: getInactivityPenaltyDeltas(wrappedState, process),
    };
  },
  {
    inputTypes: {
      pre: {
        type: InputType.SSZ_SNAPPY,
        treeBacked: true,
      },
    },
    sszTypes: {
      pre: config.types.altair.BeaconState,
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
