import {phase0, createCachedValidatorsBeaconState} from "@chainsafe/lodestar-beacon-state-transition";
import {config} from "@chainsafe/lodestar-config/mainnet";
import {describeDirectorySpecTest} from "@chainsafe/lodestar-spec-test-util/lib/single";
import {BeaconState} from "@chainsafe/lodestar-types";
import {expect} from "chai";
import {join} from "path";
import {SPEC_TEST_LOCATION} from "../../../utils/specTestCases";
import {IProcessDepositTestCase} from "./type";

describeDirectorySpecTest<IProcessDepositTestCase, BeaconState>(
  "process deposit mainnet",
  join(SPEC_TEST_LOCATION, "/tests/mainnet/phase0/operations/deposit/pyspec_tests"),
  (testcase) => {
    const state = testcase.pre;
    const epochCtx = new phase0.fast.EpochContext(config);
    epochCtx.loadState(state);
    const wrappedState = createCachedValidatorsBeaconState(state);
    phase0.fast.processDeposit(epochCtx, wrappedState, testcase.deposit);
    return state;
  },
  {
    sszTypes: {
      pre: config.types.BeaconState,
      post: config.types.BeaconState,
      deposit: config.types.Deposit,
    },
    timeout: 100000000,
    shouldError: (testCase) => !testCase.post,
    getExpected: (testCase) => testCase.post,
    expectFunc: (testCase, expected, actual) => {
      expect(config.types.BeaconState.equals(actual, expected)).to.be.true;
    },
  }
);
