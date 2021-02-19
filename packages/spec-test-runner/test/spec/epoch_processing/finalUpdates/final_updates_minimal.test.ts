import {phase0} from "@chainsafe/lodestar-beacon-state-transition";
import {config} from "@chainsafe/lodestar-config/minimal";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util/lib/single";
import {expect} from "chai";
import {join} from "path";
import {SPEC_TEST_LOCATION} from "../../../utils/specTestCases";
import {IStateTestCase} from "../../../utils/specTestTypes/stateTestCase";

describeDirectorySpecTest<IStateTestCase, phase0.BeaconState>(
  "epoch final updates minimal",
  join(SPEC_TEST_LOCATION, "tests/minimal/phase0/epoch_processing/final_updates/pyspec_tests"),
  (testcase) => {
    const state = testcase.pre;
    phase0.processFinalUpdates(config, state);
    return state;
  },
  {
    inputTypes: {
      pre: InputType.SSZ,
      post: InputType.SSZ,
    },
    sszTypes: {
      pre: config.types.phase0.BeaconState,
      post: config.types.phase0.BeaconState,
    },
    getExpected: (testCase) => testCase.post,
    expectFunc: (testCase, expected, actual) => {
      expect(config.types.phase0.BeaconState.equals(actual, expected)).to.be.true;
    },
  }
);
