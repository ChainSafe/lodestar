import {join} from "node:path";
import {TreeBacked} from "@chainsafe/ssz";
import {allForks, altair, phase0} from "@chainsafe/lodestar-beacon-state-transition";
import {describeDirectorySpecTest} from "@chainsafe/lodestar-spec-test-util";
import {ssz} from "@chainsafe/lodestar-types";
import {ACTIVE_PRESET, ForkName} from "@chainsafe/lodestar-params";
import {SPEC_TEST_LOCATION} from "../specTestVersioning";
import {IBaseSpecTest} from "../type";
import {expectEqualBeaconState, inputTypeSszTreeBacked} from "../util";
import {createIChainForkConfig, IChainConfig} from "@chainsafe/lodestar-config";

export function fork(forkConfig: Partial<IChainConfig>, pre: ForkName, fork: Exclude<ForkName, ForkName.phase0>): void {
  const testConfig = createIChainForkConfig(forkConfig);
  describeDirectorySpecTest<IUpgradeStateCase, allForks.BeaconState>(
    `${ACTIVE_PRESET}/${fork}/fork/fork`,
    join(SPEC_TEST_LOCATION, `/tests/${ACTIVE_PRESET}/${fork}/fork/fork/pyspec_tests`),
    (testcase) => {
      const preState = allForks.createCachedBeaconState(testConfig, testcase.pre as TreeBacked<allForks.BeaconState>);
      const postState = allForks.upgradeStateByFork[fork](preState);

      // Any post state will have fields belonging to altair fork. These need to be set as
      // this test has a random slot so createCachedBeaconState is not able to create indexed
      // sync committee
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
}

type PostBeaconState = Exclude<allForks.BeaconState, phase0.BeaconState>;

interface IUpgradeStateCase extends IBaseSpecTest {
  pre: allForks.BeaconState;
  post: PostBeaconState;
}
