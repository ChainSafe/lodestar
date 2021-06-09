import {join} from "path";

import {TreeBacked} from "@chainsafe/ssz";
import {allForks, altair, CachedBeaconState} from "@chainsafe/lodestar-beacon-state-transition";
import {createIBeaconConfig} from "@chainsafe/lodestar-config";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util";
import {IProcessSyncCommitteeTestCase} from "./type";
import {SPEC_TEST_LOCATION} from "../../../../utils/specTestCases";
import {expectEqualBeaconState} from "../../util";
import {ssz} from "@chainsafe/lodestar-types";
import {PresetName} from "@chainsafe/lodestar-params";

export function runSyncCommittee(presetName: PresetName): void {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const config = createIBeaconConfig({ALTAIR_FORK_EPOCH: 0});

  describeDirectorySpecTest<IProcessSyncCommitteeTestCase, altair.BeaconState>(
    `process sync committee ${presetName}`,
    join(SPEC_TEST_LOCATION, `/tests/${presetName}/altair/operations/sync_committee/pyspec_tests`),
    (testcase) => {
      const wrappedState = allForks.createCachedBeaconState<altair.BeaconState>(
        config,
        testcase.pre as TreeBacked<altair.BeaconState>
      ) as CachedBeaconState<altair.BeaconState>;

      const block = ssz.altair.BeaconBlock.defaultValue();

      // processSyncCommittee() needs the full block to get the slot
      block.slot = wrappedState.slot;
      block.body.syncAggregate = ssz.altair.SyncAggregate.createTreeBackedFromStruct(testcase["sync_aggregate"]);

      altair.processSyncCommittee(wrappedState, block);
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
        // TODO: not able to deserialzie from binary
        // sync_aggregate: {
        //   type: InputType.SSZ_SNAPPY,
        //   treeBacked: true,
        // },
        meta: InputType.YAML,
      },
      sszTypes: {
        pre: ssz.altair.BeaconState,
        post: ssz.altair.BeaconState,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        sync_aggregate: ssz.altair.SyncAggregate,
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
