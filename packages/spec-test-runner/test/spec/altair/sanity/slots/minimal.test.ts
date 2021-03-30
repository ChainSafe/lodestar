import {join} from "path";
import {expect} from "chai";
import {config} from "@chainsafe/lodestar-config/minimal";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util";
import {IProcessSlotsTestCase} from "./type";
import {SPEC_TEST_LOCATION} from "../../../../utils/specTestCases";
import {altair as altairTypes} from "@chainsafe/lodestar-types";
import {altair} from "@chainsafe/lodestar-beacon-state-transition";

describeDirectorySpecTest<IProcessSlotsTestCase, altairTypes.BeaconState>(
  "altair slot sanity minimal",
  join(SPEC_TEST_LOCATION, "/tests/minimal/lightclient_patch/sanity/slots/pyspec_tests"),
  (testcase) => {
    const state = testcase.pre;
    altair.processSlots(config, state, state.slot + Number(testcase.slots));
    return state;
  },
  {
    inputTypes: {
      slots: InputType.YAML,
    },
    sszTypes: {
      pre: config.types.altair.BeaconState,
      post: config.types.altair.BeaconState,
    },
    shouldError: (testCase) => {
      return !testCase.post;
    },
    timeout: 10000000,
    getExpected: (testCase) => testCase.post,
    expectFunc: (testCase, expected, actual) => {
      expect(config.types.altair.BeaconState.equals(actual, expected)).to.be.true;
    },
  }
);
