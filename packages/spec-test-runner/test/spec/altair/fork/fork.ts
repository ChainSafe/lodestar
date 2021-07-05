import {join} from "path";

import {TreeBacked} from "@chainsafe/ssz";
import {config} from "@chainsafe/lodestar-config/default";
import {allForks, phase0} from "@chainsafe/lodestar-beacon-state-transition";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util";
import {altair} from "@chainsafe/lodestar-beacon-state-transition";
import {ssz} from "@chainsafe/lodestar-types";
import {PresetName} from "@chainsafe/lodestar-params";
import {SPEC_TEST_LOCATION} from "../../../utils/specTestCases";
import {expectEqualBeaconState} from "../util";
import {IUpgradeStateCase} from "./type";

export function runFork(presetName: PresetName): void {
  describeDirectorySpecTest<IUpgradeStateCase, altair.BeaconState>(
    `upgrade state to altair ${presetName}`,
    join(SPEC_TEST_LOCATION, `/tests/${presetName}/altair/fork/fork/pyspec_tests`),
    (testcase) => {
      const phase0State = allForks.createCachedBeaconState<phase0.BeaconState>(
        config,
        testcase.pre as TreeBacked<phase0.BeaconState>
      );
      const altairState = altair.upgradeState(phase0State);
      // this test has a random slot so createCachedBeaconState is not able to create indexed sync committee
      const tbAltairState = altairState.type.createTreeBacked(altairState.tree);
      altairState.currentSyncCommittee = allForks.convertToIndexedSyncCommittee(
        tbAltairState.currentSyncCommittee as TreeBacked<altair.SyncCommittee>,
        altairState.pubkey2index
      );
      altairState.nextSyncCommittee = allForks.convertToIndexedSyncCommittee(
        tbAltairState.nextSyncCommittee as TreeBacked<altair.SyncCommittee>,
        altairState.pubkey2index
      );
      return altairState;
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
        meta: InputType.YAML,
      },
      sszTypes: {
        pre: ssz.phase0.BeaconState,
        post: ssz.altair.BeaconState,
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
