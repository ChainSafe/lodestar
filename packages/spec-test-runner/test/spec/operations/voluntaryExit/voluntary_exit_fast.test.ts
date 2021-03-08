import {join} from "path";
import {expect} from "chai";
import {config} from "@chainsafe/lodestar-config/mainnet";
import {phase0} from "@chainsafe/lodestar-beacon-state-transition";
import {describeDirectorySpecTest} from "@chainsafe/lodestar-spec-test-util";
import {IProcessVoluntaryExitTestCase} from "./type";
import {SPEC_TEST_LOCATION} from "../../../utils/specTestCases";

describeDirectorySpecTest<IProcessVoluntaryExitTestCase, phase0.BeaconState>(
  "process voluntary exit mainnet",
  join(SPEC_TEST_LOCATION, "/tests/mainnet/phase0/operations/voluntary_exit/pyspec_tests"),
  (testcase) => {
    const state = config.types.phase0.BeaconState.tree.createValue(testcase.pre);
    const epochCtx = new phase0.fast.EpochContext(config);
    epochCtx.loadState(state);
    const wrappedState = phase0.fast.createCachedValidatorsBeaconState(state);
    phase0.fast.processVoluntaryExit(epochCtx, wrappedState, testcase.voluntary_exit);
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
