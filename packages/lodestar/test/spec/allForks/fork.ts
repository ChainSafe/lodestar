import {join} from "node:path";
import {TreeBacked} from "@chainsafe/ssz";
import {config} from "@chainsafe/lodestar-config/default";
import {allForks, CachedBeaconStateAllForks} from "@chainsafe/lodestar-beacon-state-transition";
import {describeDirectorySpecTest} from "@chainsafe/lodestar-spec-test-util";
import {phase0, altair, bellatrix} from "@chainsafe/lodestar-beacon-state-transition";
import {ssz} from "@chainsafe/lodestar-types";
import {ACTIVE_PRESET, ForkName} from "@chainsafe/lodestar-params";
import {SPEC_TEST_LOCATION} from "../specTestVersioning";
import {IBaseSpecTest} from "../type";
import {expectEqualBeaconState, inputTypeSszTreeBacked} from "../util";

export function fork<
  PreBeaconState extends phase0.BeaconState | altair.BeaconState,
  PostBeaconState extends altair.BeaconState | bellatrix.BeaconState
>(pre: ForkName, fork: ForkName): void {
  describeDirectorySpecTest<IUpgradeStateCase, allForks.BeaconState>(
    `${ACTIVE_PRESET}/${fork}/fork/fork`,
    join(SPEC_TEST_LOCATION, `/tests/${ACTIVE_PRESET}/${fork}/fork/fork/pyspec_tests`),
    (testcase) => {
      const preState = allForks.createCachedBeaconState(config, testcase.pre as TreeBacked<PreBeaconState>);
      const postState = allForks.upgradeStateByFork[fork]((preState as unknown) as CachedBeaconStateAllForks);

      // this test has a random slot so createCachedBeaconState is not able to create indexed sync committee
      const tbPostState = (postState.type.createTreeBacked(postState.tree) as unknown) as TreeBacked<PostBeaconState>;
      postState.currentSyncCommittee = allForks.convertToIndexedSyncCommittee(
        tbPostState.currentSyncCommittee as TreeBacked<altair.SyncCommittee>,
        postState.pubkey2index
      );
      postState.nextSyncCommittee = allForks.convertToIndexedSyncCommittee(
        tbPostState.nextSyncCommittee as TreeBacked<altair.SyncCommittee>,
        postState.pubkey2index
      );
      return postState;
    },
    {
      inputTypes: inputTypeSszTreeBacked,
      sszTypes: {
        pre: ssz[pre].BeaconState,
        post: ssz[fork].BeaconState,
      },

      timeout: 10000,
      shouldError: (testCase) => testCase.post === undefined,
      getExpected: (testCase) => testCase.post,
      expectFunc: (testCase, expected, actual) => {
        expectEqualBeaconState(fork, expected, actual);
      },
    }
  );

  interface IUpgradeStateCase extends IBaseSpecTest {
    pre: PreBeaconState;
    post: PostBeaconState;
  }
}
