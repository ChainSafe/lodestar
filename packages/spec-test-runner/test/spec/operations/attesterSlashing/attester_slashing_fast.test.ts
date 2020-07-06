import {join} from "path";
import {expect} from "chai";
import {BeaconState} from "@chainsafe/lodestar-types";
import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {EpochContext} from "@chainsafe/lodestar-beacon-state-transition";
import {processAttesterSlashing} from "@chainsafe/lodestar-beacon-state-transition/lib/fast/block";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util/lib/single";
import {IProcessAttesterSlashingTestCase} from "./type";
import {SPEC_TEST_LOCATION} from "../../../utils/specTestCases";

describeDirectorySpecTest<IProcessAttesterSlashingTestCase, BeaconState>(
  "process attester slashing mainnet",
  join(SPEC_TEST_LOCATION, "/tests/mainnet/phase0/operations/attester_slashing/pyspec_tests"),
  (testcase) => {
    const state = testcase.pre;
    const epochCtx = new EpochContext(config);
    epochCtx.loadState(state);
    const verify = (!!testcase.meta && !!testcase.meta.blsSetting && testcase.meta.blsSetting === 1n);
    processAttesterSlashing(epochCtx, state, testcase.attester_slashing, verify);
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
      expect(config.types.BeaconState.equals(actual, expected)).to.be.true;
    }
  }
);

