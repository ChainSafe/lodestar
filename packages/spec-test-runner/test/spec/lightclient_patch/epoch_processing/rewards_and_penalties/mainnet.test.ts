import {join} from "path";
import {expect} from "chai";

import {config} from "@chainsafe/lodestar-config/mainnet";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util";
import {lightclient} from "@chainsafe/lodestar-beacon-state-transition";
import {lightclient as lightclientTypes} from "@chainsafe/lodestar-types";
import {SPEC_TEST_LOCATION} from "../../../../utils/specTestCases";
import {ILightclientStateTestCase} from "../../stateTestCase";

describeDirectorySpecTest<ILightclientStateTestCase, lightclientTypes.BeaconState>(
  "lightclient epoch rewards and penalties mainnet",
  join(SPEC_TEST_LOCATION, "tests/mainnet/lightclient_patch/epoch_processing/rewards_and_penalties/pyspec_tests"),
  (testcase) => {
    const state = testcase.pre;
    lightclient.processRewardsAndPenalties(config, state);
    return state;
  },
  {
    inputTypes: {
      pre: InputType.SSZ,
      post: InputType.SSZ,
    },
    sszTypes: {
      pre: config.types.lightclient.BeaconState,
      post: config.types.lightclient.BeaconState,
    },
    getExpected: (testCase) => testCase.post,
    expectFunc: (testCase, expected, actual) => {
      expect(config.types.lightclient.BeaconState.equals(actual, expected)).to.be.true;
    },
  }
);
