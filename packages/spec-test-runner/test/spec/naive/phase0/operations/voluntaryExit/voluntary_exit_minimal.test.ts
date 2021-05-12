import {join} from "path";
import {expect} from "chai";
import {config} from "@chainsafe/lodestar-config/minimal";
import {phase0, naive} from "@chainsafe/lodestar-beacon-state-transition";
import {describeDirectorySpecTest} from "@chainsafe/lodestar-spec-test-util";
import {IProcessVoluntaryExitTestCase} from "./type";
import {SPEC_TEST_LOCATION} from "../../../../../utils/specTestCases";

describeDirectorySpecTest<IProcessVoluntaryExitTestCase, phase0.BeaconState>(
  "process voluntary exit minimal",
  join(SPEC_TEST_LOCATION, "/tests/minimal/phase0/operations/voluntary_exit/pyspec_tests"),
  (testcase) => {
    const state = testcase.pre;
    const verify = !!testcase.meta && !!testcase.meta.blsSetting && testcase.meta.blsSetting === BigInt(1);
    naive.phase0.processVoluntaryExit(config, state, testcase.voluntary_exit, verify);
    return state;
  },
  {
    sszTypes: {
      pre: config.types.phase0.BeaconState,
      post: config.types.phase0.BeaconState,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      voluntary_exit: config.types.phase0.SignedVoluntaryExit,
    },
    timeout: 100000000,
    shouldError: (testCase) => !testCase.post,
    getExpected: (testCase) => testCase.post,
    expectFunc: (testCase, expected, actual) => {
      expect(config.types.phase0.BeaconState.equals(actual, expected)).to.be.true;
    },
  }
);
