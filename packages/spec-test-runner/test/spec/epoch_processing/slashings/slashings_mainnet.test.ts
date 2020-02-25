import {join} from "path";
import {expect} from "chai";

import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {BeaconState} from "@chainsafe/lodestar-types";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util/lib/single";
import {StateTestCase} from "../../../utils/specTestTypes/stateTestCase";
import {processSlashings} from "@chainsafe/lodestar-beacon-state-transition";
import {SPEC_TEST_LOCATION} from "../../../utils/specTestCases";

describeDirectorySpecTest<StateTestCase, BeaconState>(
  "epoch slashings mainnet",
  join(SPEC_TEST_LOCATION, "/tests/mainnet/phase0/epoch_processing/slashings/pyspec_tests"),
  (testcase) => {
    const state = testcase.pre;
    processSlashings(config, state);
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
    getExpected: (testCase => testCase.post),
    expectFunc: (testCase, expected, actual) => {
      expect(config.types.BeaconState.equals(actual, expected)).to.be.true;
    }
  }
);

