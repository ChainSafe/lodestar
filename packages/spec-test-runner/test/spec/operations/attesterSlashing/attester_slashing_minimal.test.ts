import {join} from "path";
import {expect} from "chai";
import {equals} from "@chainsafe/ssz";
import {config} from "@chainsafe/eth2.0-config/lib/presets/minimal";
import {processAttesterSlashing} from "@chainsafe/eth2.0-state-transition";
import {BeaconState} from "@chainsafe/eth2.0-types";
import {describeDirectorySpecTest, InputType} from "@chainsafe/eth2.0-spec-test-util/lib/single";
import {IProcessAttesterSlashingTestCase} from "./type";
import {SPEC_TEST_LOCATION} from "../../../utils/specTestCases";

describeDirectorySpecTest<IProcessAttesterSlashingTestCase, BeaconState>(
  "process attester slashing minimal",
  join(SPEC_TEST_LOCATION, "/tests/minimal/phase0/operations/attester_slashing/pyspec_tests"),
  (testcase) => {
    const state = testcase.pre;
    const verify = (!!testcase.meta && !!testcase.meta.blsSetting && testcase.meta.blsSetting === 1n);
    processAttesterSlashing(config, state, testcase.attester_slashing, verify);
    return state;
  },
  {
    inputTypes: {
      meta: InputType.YAML
    },
    sszTypes: {
      pre: config.types.BeaconState,
      post: config.types.BeaconState,
      // eslint-disable-next-line @typescript-eslint/camelcase
      attester_slashing: config.types.AttesterSlashing,
    },
    timeout: 100000000,
    shouldError: testCase => !testCase.post,
    getExpected: (testCase => testCase.post),
    expectFunc: (testCase, expected, actual) => {
      expect(equals(config.types.BeaconState, actual, expected)).to.be.true;
    }
  }
);

