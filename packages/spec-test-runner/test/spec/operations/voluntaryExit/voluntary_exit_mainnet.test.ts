import {join} from "path";
import {expect} from "chai";
import {BeaconState} from "@chainsafe/lodestar-types";
import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {processVoluntaryExit} from "@chainsafe/lodestar-beacon-state-transition";
import {describeDirectorySpecTest} from "@chainsafe/lodestar-spec-test-util/lib/single";
import {IProcessVoluntaryExitTestCase} from "./type";
import {SPEC_TEST_LOCATION} from "../../../utils/specTestCases";

describeDirectorySpecTest<IProcessVoluntaryExitTestCase, BeaconState>(
  "process voluntary exit mainnet",
  join(SPEC_TEST_LOCATION, "/tests/mainnet/phase0/operations/voluntary_exit/pyspec_tests"),
  (testcase) => {
    const state = testcase.pre;
    const verify = (!!testcase.meta && !!testcase.meta.blsSetting && testcase.meta.blsSetting === 1n);
    processVoluntaryExit(config, state, testcase.voluntary_exit, verify);
    return state;
  },
  {
    sszTypes: {
      pre: config.types.BeaconState,
      post: config.types.BeaconState,
      // eslint-disable-next-line @typescript-eslint/camelcase
      voluntary_exit: config.types.SignedVoluntaryExit,
    },
    timeout: 100000000,
    shouldError: testCase => !testCase.post,
    getExpected: (testCase => testCase.post),
    expectFunc: (testCase, expected, actual) => {
      expect(config.types.BeaconState.equals(actual, expected)).to.be.true;
    }
  }
);

