import {join} from "path";
import {expect} from "chai";

import {TreeBacked} from "@chainsafe/ssz";
import {config} from "@chainsafe/lodestar-config/default";
import {CachedBeaconState, allForks, phase0} from "@chainsafe/lodestar-beacon-state-transition";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util";
import {IStateTestCase} from "../../../../utils/specTestTypes/stateTestCase";
import {SPEC_TEST_LOCATION} from "../../../../utils/specTestCases";
import {ssz} from "@chainsafe/lodestar-types";

describeDirectorySpecTest<IStateTestCase, phase0.BeaconState>(
  "epoch registry updates mainnet",
  join(SPEC_TEST_LOCATION, "/tests/mainnet/phase0/epoch_processing/registry_updates/pyspec_tests"),
  (testcase) => {
    const wrappedState = allForks.createCachedBeaconState<phase0.BeaconState>(
      config,
      testcase.pre as TreeBacked<phase0.BeaconState>
    );
    const process = allForks.prepareEpochProcessState(wrappedState);
    phase0.processRegistryUpdates(wrappedState as CachedBeaconState<allForks.BeaconState>, process);
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
    },
    getExpected: (testCase) => testCase.post,
    expectFunc: (testCase, expected, actual) => {
      expect(ssz.phase0.BeaconState.equals(actual, expected)).to.be.true;
    },
  }
);
