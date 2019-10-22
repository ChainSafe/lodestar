import {join} from "path";
import {expect} from "chai";
import {equals} from "@chainsafe/ssz";
import {config} from "@chainsafe/eth2.0-config/lib/presets/minimal";
import {processVoluntaryExit} from "../../../../../eth2.0-state-transition/src/block/operations";
import {BeaconState} from "@chainsafe/eth2.0-types";
import {describeDirectorySpecTest} from "@chainsafe/eth2.0-spec-test-util/lib/single";
import {ProcessVoluntaryExitTestCase} from "./type";
import {SPEC_TEST_LOCATION} from "../../../utils/specTestCases";

describeDirectorySpecTest<ProcessVoluntaryExitTestCase, BeaconState>(
  "process voluntary exit minimal",
  join(SPEC_TEST_LOCATION, "/tests/minimal/phase0/operations/voluntary_exit/pyspec_tests"),
  (testcase) => {
    const state = testcase.pre;
    processVoluntaryExit(config, state, testcase.voluntary_exit);
    return state;
  },
  {
    sszTypes: {
      pre: config.types.BeaconState,
      post: config.types.BeaconState,
      // eslint-disable-next-line @typescript-eslint/camelcase
      voluntary_exit: config.types.VoluntaryExit,
    },
    timeout: 100000000,
    shouldError: testCase => !testCase.post,
    getExpected: (testCase => testCase.post),
    expectFunc: (testCase, expected, actual) => {
      expect(equals(actual, expected, config.types.BeaconState)).to.be.true;
    }
  }
);

