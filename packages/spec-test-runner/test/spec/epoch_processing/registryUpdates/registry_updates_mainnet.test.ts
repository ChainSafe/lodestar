import {join} from "path";
import {expect} from "chai";
import {equals} from "@chainsafe/ssz";

import {config} from "@chainsafe/eth2.0-config/lib/presets/mainnet";
import {BeaconState} from "@chainsafe/eth2.0-types";
import {describeDirectorySpecTest, InputType} from "@chainsafe/eth2.0-spec-test-util/lib/single";
import {StateTestCase} from "../../../utils/specTestTypes/stateTestCase";
import {processRegistryUpdates} from "@chainsafe/eth2.0-state-transition";
import {SPEC_TEST_LOCATION} from "../../../utils/specTestCases";

describeDirectorySpecTest<StateTestCase, BeaconState>(
  "epoch registry updates mainnet",
  join(SPEC_TEST_LOCATION, "/tests/mainnet/phase0/epoch_processing/registry_updates/pyspec_tests"),
  (testcase) => {
    const state = testcase.pre;
    processRegistryUpdates(config, state);
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
      expect(equals(config.types.BeaconState, actual, expected)).to.be.true;
    }
  }
);

