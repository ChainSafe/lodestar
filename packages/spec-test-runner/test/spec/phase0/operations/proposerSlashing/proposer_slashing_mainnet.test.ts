import {join} from "path";

import {TreeBacked} from "@chainsafe/ssz";
import {config} from "@chainsafe/lodestar-config/default";
import {allForks, phase0} from "@chainsafe/lodestar-beacon-state-transition";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util";
import {IProcessProposerSlashingTestCase} from "./type";
import {SPEC_TEST_LOCATION} from "../../../../utils/specTestCases";
import {ssz} from "@chainsafe/lodestar-types";
import {expectEqualBeaconStatePhase0} from "../../../util";

describeDirectorySpecTest<IProcessProposerSlashingTestCase, phase0.BeaconState>(
  "process proposer slashing mainnet",
  join(SPEC_TEST_LOCATION, "/tests/mainnet/phase0/operations/proposer_slashing/pyspec_tests"),
  (testcase) => {
    const wrappedState = allForks.createCachedBeaconState<phase0.BeaconState>(
      config,
      testcase.pre as TreeBacked<phase0.BeaconState>
    );
    phase0.processProposerSlashing(wrappedState, testcase.proposer_slashing, {});
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
      pre: ssz.phase0.BeaconState,
      post: ssz.phase0.BeaconState,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      proposer_slashing: ssz.phase0.ProposerSlashing,
    },
    timeout: 100000000,
    shouldError: (testCase) => !testCase.post,
    getExpected: (testCase) => testCase.post,
    expectFunc: (testCase, expected, actual) => {
      expectEqualBeaconStatePhase0(expected, actual);
    },
  }
);
