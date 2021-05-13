import {join} from "path";
import {expect} from "chai";
import {config} from "@chainsafe/lodestar-config/mainnet";
import {phase0, naive} from "@chainsafe/lodestar-beacon-state-transition";
import {describeDirectorySpecTest} from "@chainsafe/lodestar-spec-test-util";
import {IProcessDepositTestCase} from "./type";
import {SPEC_TEST_LOCATION} from "../../../../../utils/specTestCases";

describeDirectorySpecTest<IProcessDepositTestCase, phase0.BeaconState>(
  "process deposit mainnet",
  join(SPEC_TEST_LOCATION, "/tests/mainnet/phase0/operations/deposit/pyspec_tests"),
  (testcase) => {
    const state = testcase.pre;
    naive.phase0.processDeposit(config, state, testcase.deposit);
    return state;
  },
  {
    sszTypes: {
      pre: config.types.phase0.BeaconState,
      post: config.types.phase0.BeaconState,
      deposit: config.types.phase0.Deposit,
    },
    timeout: 100000000,
    shouldError: (testCase) => !testCase.post,
    getExpected: (testCase) => testCase.post,
    expectFunc: (testCase, expected, actual) => {
      expect(config.types.phase0.BeaconState.equals(actual, expected)).to.be.true;
    },
  }
);
