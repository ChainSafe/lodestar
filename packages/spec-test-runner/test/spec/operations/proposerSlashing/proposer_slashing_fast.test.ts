import {join} from "path";
import {expect} from "chai";

import {TreeBacked} from "@chainsafe/ssz";
import {config} from "@chainsafe/lodestar-config/mainnet";
import {fast, phase0} from "@chainsafe/lodestar-beacon-state-transition";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util";
import {IProcessProposerSlashingTestCase} from "./type";
import {SPEC_TEST_LOCATION} from "../../../utils/specTestCases";

describeDirectorySpecTest<IProcessProposerSlashingTestCase, phase0.BeaconState>(
  "process proposer slashing mainnet",
  join(SPEC_TEST_LOCATION, "/tests/mainnet/phase0/operations/proposer_slashing/pyspec_tests"),
  (testcase) => {
    const wrappedState = fast.createCachedBeaconState<phase0.BeaconState>(
      config,
      testcase.pre as TreeBacked<phase0.BeaconState>
    );
    phase0.fast.processProposerSlashing(wrappedState, testcase.proposer_slashing);
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
      // eslint-disable-next-line @typescript-eslint/naming-convention
      proposer_slashing: config.types.phase0.ProposerSlashing,
    },
    timeout: 100000000,
    shouldError: (testCase) => !testCase.post,
    getExpected: (testCase) => testCase.post,
    expectFunc: (testCase, expected, actual) => {
      expect(config.types.phase0.BeaconState.equals(actual, expected)).to.be.true;
    },
  }
);
