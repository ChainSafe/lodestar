import {join} from "path";
import {expect} from "chai";
import {BeaconState} from "@chainsafe/lodestar-types";
import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {processProposerSlashing} from "@chainsafe/lodestar-beacon-state-transition";
import {describeDirectorySpecTest} from "@chainsafe/lodestar-spec-test-util/lib/single";
import {IProcessProposerSlashingTestCase} from "./type";
import {SPEC_TEST_LOCATION} from "../../../utils/specTestCases";

describeDirectorySpecTest<IProcessProposerSlashingTestCase, BeaconState>(
  "process proposer slashing mainnet",
  join(SPEC_TEST_LOCATION, "/tests/mainnet/phase0/operations/proposer_slashing/pyspec_tests"),
  (testcase) => {
    const state = testcase.pre;
    const verify = (!!testcase.meta && !!testcase.meta.blsSetting && testcase.meta.blsSetting === 1n);
    processProposerSlashing(config, state, testcase.proposer_slashing, verify);
    return state;
  },
  {
    sszTypes: {
      pre: config.types.BeaconState,
      post: config.types.BeaconState,
      // eslint-disable-next-line @typescript-eslint/camelcase
      proposer_slashing: config.types.ProposerSlashing,
    },
    timeout: 100000000,
    shouldError: testCase => !testCase.post,
    getExpected: (testCase => testCase.post),
    expectFunc: (testCase, expected, actual) => {
      expect(config.types.BeaconState.equals(actual, expected)).to.be.true;
    }
  }
);

