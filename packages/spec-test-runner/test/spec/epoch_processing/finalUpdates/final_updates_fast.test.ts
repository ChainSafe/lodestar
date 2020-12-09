import {join} from "path";
import {expect} from "chai";

import {config} from "@chainsafe/lodestar-config/mainnet";
import {EpochContext} from "@chainsafe/lodestar-beacon-state-transition";
import {processFinalUpdates} from "@chainsafe/lodestar-beacon-state-transition/lib/fast/epoch";
import {prepareEpochProcessState} from "@chainsafe/lodestar-beacon-state-transition/lib/fast/util";
import {createCachedValidatorsBeaconState} from "@chainsafe/lodestar-beacon-state-transition/lib/fast/util/interface";
import {BeaconState} from "@chainsafe/lodestar-types";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util/lib/single";
import {IStateTestCase} from "../../../utils/specTestTypes/stateTestCase";
import {SPEC_TEST_LOCATION} from "../../../utils/specTestCases";

describeDirectorySpecTest<IStateTestCase, BeaconState>(
  "epoch final updates mainnet",
  join(SPEC_TEST_LOCATION, "tests/mainnet/phase0/epoch_processing/final_updates/pyspec_tests"),
  (testcase) => {
    const state = testcase.pre;
    const epochCtx = new EpochContext(config);
    epochCtx.loadState(state);
    const wrappedState = createCachedValidatorsBeaconState(state);
    const process = prepareEpochProcessState(epochCtx, wrappedState);
    processFinalUpdates(epochCtx, process, wrappedState);
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
