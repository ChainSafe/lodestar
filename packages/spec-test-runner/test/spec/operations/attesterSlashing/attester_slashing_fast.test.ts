import {join} from "path";
import {expect} from "chai";

import {TreeBacked} from "@chainsafe/ssz";
import {config} from "@chainsafe/lodestar-config/mainnet";
import {fast, phase0} from "@chainsafe/lodestar-beacon-state-transition";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util";
import {IProcessAttesterSlashingTestCase} from "./type";
import {SPEC_TEST_LOCATION} from "../../../utils/specTestCases";

describeDirectorySpecTest<IProcessAttesterSlashingTestCase, phase0.BeaconState>(
  "process attester slashing mainnet",
  join(SPEC_TEST_LOCATION, "/tests/mainnet/phase0/operations/attester_slashing/pyspec_tests"),
  (testcase) => {
    const wrappedState = fast.createCachedBeaconState<phase0.BeaconState>(
      config,
      testcase.pre as TreeBacked<phase0.BeaconState>
    );
    const verify = !!testcase.meta && !!testcase.meta.blsSetting && testcase.meta.blsSetting === BigInt(1);
    phase0.fast.processAttesterSlashing(wrappedState, testcase.attester_slashing, verify);
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
      meta: InputType.YAML,
    },
    sszTypes: {
      pre: config.types.phase0.BeaconState,
      post: config.types.phase0.BeaconState,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      attester_slashing: config.types.phase0.AttesterSlashing,
    },
    timeout: 100000000,
    shouldError: (testCase) => !testCase.post,
    getExpected: (testCase) => testCase.post,
    expectFunc: (testCase, expected, actual) => {
      expect(config.types.phase0.BeaconState.equals(actual, expected)).to.be.true;
    },
  }
);
