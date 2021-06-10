import {join} from "path";

import {TreeBacked} from "@chainsafe/ssz";
import {allForks, altair} from "@chainsafe/lodestar-beacon-state-transition";
import {createIBeaconConfig} from "@chainsafe/lodestar-config";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util";
import {IProcessProposerSlashingTestCase} from "./type";
import {SPEC_TEST_LOCATION} from "../../../../utils/specTestCases";
import {expectEqualBeaconState} from "../../util";
import {ssz} from "@chainsafe/lodestar-types";
import {PresetName} from "@chainsafe/lodestar-params";

export function runProposerSlashing(presetName: PresetName): void {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const config = createIBeaconConfig({ALTAIR_FORK_EPOCH: 0});

  describeDirectorySpecTest<IProcessProposerSlashingTestCase, altair.BeaconState>(
    `process proposer slashing ${presetName}`,
    join(SPEC_TEST_LOCATION, `/tests/${presetName}/altair/operations/proposer_slashing/pyspec_tests`),
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
        pre: ssz.altair.BeaconState,
        post: ssz.altair.BeaconState,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        proposer_slashing: ssz.phase0.ProposerSlashing,
      },
      timeout: 10000,
      shouldError: (testCase) => !testCase.post,
      getExpected: (testCase) => testCase.post,
      expectFunc: (testCase, expected, actual) => {
        expectEqualBeaconState(config, expected, actual);
      },
    }
  );
}
