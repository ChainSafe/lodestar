import {join} from "path";
import {TreeBacked} from "@chainsafe/ssz";
import {config} from "@chainsafe/lodestar-config/default";
import {allForks, phase0} from "@chainsafe/lodestar-beacon-state-transition";
import {describeDirectorySpecTest} from "@chainsafe/lodestar-spec-test-util";
import {altair} from "@chainsafe/lodestar-beacon-state-transition";
import {ssz} from "@chainsafe/lodestar-types";
import {ACTIVE_PRESET, ForkName} from "@chainsafe/lodestar-params";
import {SPEC_TEST_LOCATION} from "../../specTestVersioning";
import {IBaseSpecTest} from "../type";
import {expectEqualBeaconState, inputTypeSszTreeBacked} from "../util";

describeDirectorySpecTest<IUpgradeStateCase, altair.BeaconState>(
  `${ACTIVE_PRESET}/altair/fork/fork`,
  join(SPEC_TEST_LOCATION, `/tests/${ACTIVE_PRESET}/altair/fork/fork/pyspec_tests`),
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
    inputTypes: inputTypeSszTreeBacked,
    sszTypes: {
      pre: ssz.phase0.BeaconState,
      post: ssz.altair.BeaconState,
    },

    timeout: 10000,
    shouldError: (testCase) => testCase.post === undefined,
    getExpected: (testCase) => testCase.post,
    expectFunc: (testCase, expected, actual) => {
      expectEqualBeaconState(ForkName.altair, expected, actual);
    },
  }
);

interface IUpgradeStateCase extends IBaseSpecTest {
  pre: phase0.BeaconState;
  post: altair.BeaconState;
}
