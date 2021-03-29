import {join} from "path";
import {expect} from "chai";

import {config} from "@chainsafe/lodestar-config/minimal";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util";
import {altair} from "@chainsafe/lodestar-beacon-state-transition";
import {altair as altairTypes} from "@chainsafe/lodestar-types";
import {SPEC_TEST_LOCATION} from "../../../../utils/specTestCases";
import {ILightclientStateTestCase} from "../../stateTestCase";

describeDirectorySpecTest<ILightclientStateTestCase, altairTypes.BeaconState>(
  "altair epoch justification and finalization minimal",
  join(
    SPEC_TEST_LOCATION,
    "tests/minimal/lightclient_patch/epoch_processing/justification_and_finalization/pyspec_tests"
  ),
  (testcase) => {
    const state = testcase.pre;
    altair.processJustificationAndFinalization(config, state);
    return state;
  },
  {
    inputTypes: {
      pre: InputType.SSZ,
      post: InputType.SSZ,
    },
    sszTypes: {
      pre: config.types.altair.BeaconState,
      post: config.types.altair.BeaconState,
    },
    getExpected: (testCase) => testCase.post,
    expectFunc: (testCase, expected, actual) => {
      expect(config.types.altair.BeaconState.equals(actual, expected)).to.be.true;
    },
  }
);
