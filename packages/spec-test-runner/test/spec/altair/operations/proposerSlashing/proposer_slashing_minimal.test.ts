import {join} from "path";
import {expect} from "chai";

import {TreeBacked} from "@chainsafe/ssz";
import {allForks, altair} from "@chainsafe/lodestar-beacon-state-transition";
import {params} from "@chainsafe/lodestar-params/minimal";
import {createIBeaconConfig} from "@chainsafe/lodestar-config";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util";
import {IProcessProposerSlashingTestCase} from "./type";
import {SPEC_TEST_LOCATION} from "../../../../utils/specTestCases";

// eslint-disable-next-line @typescript-eslint/naming-convention
const config = createIBeaconConfig({...params, ALTAIR_FORK_EPOCH: 0});

describeDirectorySpecTest<IProcessProposerSlashingTestCase, altair.BeaconState>(
  "process proposer slashing minimal",
  join(SPEC_TEST_LOCATION, "/tests/minimal/altair/operations/proposer_slashing/pyspec_tests"),
  (testcase) => {
    const wrappedState = allForks.createCachedBeaconState<altair.BeaconState>(
      config,
      testcase.pre as TreeBacked<altair.BeaconState>
    );
    altair.processProposerSlashing(wrappedState, testcase.proposer_slashing);
    return wrappedState;
  },
  {
    inputTypes: {
      pre: {
        type: InputType.SSZ_SNAPPY,
        treeBacked: true,
      },
      post: {
        type: InputType.SSZ_SNAPPY,
        treeBacked: true,
      },
    },
    sszTypes: {
      pre: config.types.altair.BeaconState,
      post: config.types.altair.BeaconState,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      proposer_slashing: config.types.phase0.ProposerSlashing,
    },
    timeout: 100000000,
    shouldError: (testCase) => !testCase.post,
    getExpected: (testCase) => testCase.post,
    expectFunc: (testCase, expected, actual) => {
      expect(config.types.altair.BeaconState.equals(actual, expected)).to.be.true;
    },
  }
);
