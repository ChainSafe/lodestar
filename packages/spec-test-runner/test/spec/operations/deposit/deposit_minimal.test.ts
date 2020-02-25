import {join} from "path";
import {expect} from "chai";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import {processDeposit} from "@chainsafe/lodestar-beacon-state-transition";
import {BeaconState} from "@chainsafe/lodestar-types";
import {describeDirectorySpecTest} from "@chainsafe/lodestar-spec-test-util/lib/single";
import {ProcessDepositTestCase} from "./type";
import {SPEC_TEST_LOCATION} from "../../../utils/specTestCases";

describeDirectorySpecTest<ProcessDepositTestCase, BeaconState>(
  "process deposit minimal",
  join(SPEC_TEST_LOCATION, "/tests/minimal/phase0/operations/deposit/pyspec_tests"),
  (testcase) => {
    const state = testcase.pre;
    processDeposit(config, state, testcase.deposit);
    return state;
  },
  {
    sszTypes: {
      pre: config.types.BeaconState,
      post: config.types.BeaconState,
      deposit: config.types.Deposit,
    },
    timeout: 100000000,
    shouldError: testCase => !testCase.post,
    getExpected: (testCase => testCase.post),
    expectFunc: (testCase, expected, actual) => {
      expect(config.types.BeaconState.equals(actual, expected)).to.be.true;
    }
  }
);

