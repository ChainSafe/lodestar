import {join} from "node:path";
import {TreeBacked} from "@chainsafe/ssz";
import {config} from "@chainsafe/lodestar-config/default";
import {allForks} from "@chainsafe/lodestar-beacon-state-transition";
import {describeDirectorySpecTest} from "@chainsafe/lodestar-spec-test-util";
import {altair, bellatrix} from "@chainsafe/lodestar-beacon-state-transition";
import {ssz} from "@chainsafe/lodestar-types";
import {ACTIVE_PRESET, ForkName} from "@chainsafe/lodestar-params";
import {SPEC_TEST_LOCATION} from "../specTestVersioning";
import {IBaseSpecTest} from "../type";
import {expectEqualBeaconState, inputTypeSszTreeBacked} from "../util";

describeDirectorySpecTest<IUpgradeStateCase, bellatrix.BeaconState>(
  `${ACTIVE_PRESET}/bellatrix/fork/fork`,
  join(SPEC_TEST_LOCATION, `/tests/${ACTIVE_PRESET}/bellatrix/fork/fork/pyspec_tests`),
  (testcase) => {
    const altairState = allForks.createCachedBeaconState(config, testcase.pre as TreeBacked<altair.BeaconState>);
    const bellatrixState = bellatrix.upgradeState(altairState);

    // See altair/fork.test.ts for why we have to explicity set treebacked currentSyncCommittee
    // and nextSyncCommittee
    const tbBellatrixState = bellatrixState.type.createTreeBacked(bellatrixState.tree);
    bellatrixState.currentSyncCommittee = allForks.convertToIndexedSyncCommittee(
      tbBellatrixState.currentSyncCommittee as TreeBacked<altair.SyncCommittee>,
      bellatrixState.pubkey2index
    );
    bellatrixState.nextSyncCommittee = allForks.convertToIndexedSyncCommittee(
      tbBellatrixState.nextSyncCommittee as TreeBacked<altair.SyncCommittee>,
      bellatrixState.pubkey2index
    );
    return bellatrixState;
  },
  {
    inputTypes: inputTypeSszTreeBacked,
    sszTypes: {
      pre: ssz.altair.BeaconState,
      post: ssz.bellatrix.BeaconState,
    },

    timeout: 10000,
    shouldError: (testCase) => testCase.post === undefined,
    getExpected: (testCase) => testCase.post,
    expectFunc: (testCase, expected, actual) => {
      expectEqualBeaconState(ForkName.bellatrix, expected, actual);
    },
  }
);

interface IUpgradeStateCase extends IBaseSpecTest {
  pre: altair.BeaconState;
  post: bellatrix.BeaconState;
}
