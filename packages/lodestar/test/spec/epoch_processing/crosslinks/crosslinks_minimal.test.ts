import {join} from "path";

import {config} from "@chainsafe/eth2.0-config/lib/presets/minimal";
import {processCrosslinks} from "../../../../src/chain/stateTransition/epoch/crosslinks";
import {BeaconState} from "@chainsafe/eth2.0-types";
import {describeDirectorySpecTest, InputType} from "@chainsafe/eth2.0-spec-test-util/lib/single";
import {equals} from "@chainsafe/ssz";
import {expect} from "chai";
import {StateTestCase} from "../../../utils/specTestTypes/stateTestCase";
import {SPEC_TEST_LOCATION} from "../../../utils/specTestCases";

describeDirectorySpecTest<StateTestCase, BeaconState>(
  "epoch_croslinks minimal",
  join(SPEC_TEST_LOCATION, "/tests/minimal/phase0/epoch_processing/crosslinks/pyspec_tests"),
  (testcase) => {
    const state = testcase.pre;
    processCrosslinks(config, state);
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
      expect(equals(actual, expected, config.types.BeaconState)).to.be.true;
    }
  }
);

