import {join} from "path";
import {expect} from "chai";

import {config} from "@chainsafe/lodestar-config/minimal";
import {EpochContext} from "@chainsafe/lodestar-beacon-state-transition";
import {processRewardsAndPenalties} from "@chainsafe/lodestar-beacon-state-transition/lib/fast/epoch";
import {prepareEpochProcessState} from "@chainsafe/lodestar-beacon-state-transition/lib/fast/util";
import {createCachedValidatorsBeaconState} from "@chainsafe/lodestar-beacon-state-transition/lib/fast/util/interface";
import {BeaconState} from "@chainsafe/lodestar-types";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util/lib/single";
import {IStateTestCase} from "../../../utils/specTestTypes/stateTestCase";
import {SPEC_TEST_LOCATION} from "../../../utils/specTestCases";

describeDirectorySpecTest<IStateTestCase, BeaconState>(
  "rewards and penalties minimal",
  join(SPEC_TEST_LOCATION, "tests/minimal/phase0/epoch_processing/rewards_and_penalties/pyspec_tests"),
  (testcase) => {
    const state = testcase.pre;
    const epochCtx = new EpochContext(config);
    epochCtx.loadState(state);
    const wrappedState = createCachedValidatorsBeaconState(state);
    const process = prepareEpochProcessState(epochCtx, wrappedState);
    processRewardsAndPenalties(epochCtx, process, wrappedState);
    return state;
  },
  {
    inputTypes: {
      pre: InputType.SSZ,
      post: InputType.SSZ,
    },
    sszTypes: {
      pre: config.types.BeaconState,
      post: config.types.BeaconState,
    },
    getExpected: (testCase) => testCase.post,
    expectFunc: (testCase, expected, actual) => {
      expect(config.types.BeaconState.equals(actual, expected)).to.be.true;
    },
  }
);
