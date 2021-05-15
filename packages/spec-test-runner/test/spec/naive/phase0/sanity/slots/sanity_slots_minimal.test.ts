import {join} from "path";
import {expect} from "chai";
import {config} from "@chainsafe/lodestar-config/minimal";
import {phase0, naive} from "@chainsafe/lodestar-beacon-state-transition";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util";
import {IProcessSlotsTestCase} from "./type";
import {SPEC_TEST_LOCATION} from "../../../../../utils/specTestCases";
import {BeaconState} from "@chainsafe/lodestar-types/phase0";

/* eslint-disable-next-line @typescript-eslint/ban-ts-comment */

describeDirectorySpecTest<IProcessSlotsTestCase, phase0.BeaconState>(
  "slot sanity minimal",
  join(SPEC_TEST_LOCATION, "/tests/minimal/phase0/sanity/slots/pyspec_tests"),
  (testcase) => {
    const state = testcase.pre as BeaconState;
    naive.phase0.processSlots(config, state, state.slot + Number(testcase.slots));
    return state;
  },
  {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    inputTypes: {
      slots: InputType.YAML,
    },
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    sszTypes: {
      pre: config.types.phase0.BeaconState,
      post: config.types.phase0.BeaconState,
    },
    shouldError: (testCase) => {
      return !testCase.post;
    },
    timeout: 10000000,
    getExpected: (testCase) => testCase.post as BeaconState,
    expectFunc: (testCase, expected, actual) => {
      expect(config.types.phase0.BeaconState.equals(actual, expected)).to.be.true;
    },
  }
);
