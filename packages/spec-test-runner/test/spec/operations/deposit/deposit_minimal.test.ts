import {join} from "path";
import {expect} from "chai";
import {config} from "@chainsafe/lodestar-config/minimal";
import {phase0} from "@chainsafe/lodestar-beacon-state-transition";
import {describeDirectorySpecTest} from "@chainsafe/lodestar-spec-test-util";
import {IProcessDepositTestCase} from "./type";
import {SPEC_TEST_LOCATION} from "../../../utils/specTestCases";

describeDirectorySpecTest<IProcessDepositTestCase, phase0.BeaconState>(
  "process deposit minimal",
  join(SPEC_TEST_LOCATION, "/tests/minimal/phase0/operations/deposit/pyspec_tests"),
  (testcase) => {
    const state = testcase.pre;
    phase0.processDeposit(config, state, testcase.deposit);
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
