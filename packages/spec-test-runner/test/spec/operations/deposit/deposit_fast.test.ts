import {TreeBacked} from "@chainsafe/ssz";
import {fast, phase0} from "@chainsafe/lodestar-beacon-state-transition";
import {config} from "@chainsafe/lodestar-config/mainnet";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util";
import {expect} from "chai";
import {join} from "path";
import {SPEC_TEST_LOCATION} from "../../../utils/specTestCases";
import {IProcessDepositTestCase} from "./type";

describeDirectorySpecTest<IProcessDepositTestCase, phase0.BeaconState>(
  "process deposit mainnet",
  join(SPEC_TEST_LOCATION, "/tests/mainnet/phase0/operations/deposit/pyspec_tests"),
  (testcase) => {
    const wrappedState = fast.createCachedBeaconState<phase0.BeaconState>(
      config,
      testcase.pre as TreeBacked<phase0.BeaconState>
    );
    phase0.fast.processDeposit(wrappedState, testcase.deposit);
    return wrappedState;
  },
  {
    inputTypes: {
      pre: {
        type: InputType.SSZ,
        treeBacked: true,
      },
      post: {
        type: InputType.SSZ,
        treeBacked: true,
      },
    },
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
