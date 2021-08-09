import {CachedBeaconState, allForks, phase0} from "@chainsafe/lodestar-beacon-state-transition";
import {config} from "@chainsafe/lodestar-config/default";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util";
import {ssz} from "@chainsafe/lodestar-types";
import {TreeBacked} from "@chainsafe/ssz";
import {expect} from "chai";
import {join} from "path";
import {SPEC_TEST_LOCATION} from "../../../../utils/specTestCases";
import {IStateTestCase} from "../../../../utils/specTestTypes/stateTestCase";

describeDirectorySpecTest<IStateTestCase, phase0.BeaconState>(
  "epoch justification and finalization mainnet",
  join(SPEC_TEST_LOCATION, "tests/mainnet/phase0/epoch_processing/justification_and_finalization/pyspec_tests"),
  (testcase) => {
    const wrappedState = allForks.createCachedBeaconState<phase0.BeaconState>(
      config,
      testcase.pre as TreeBacked<phase0.BeaconState>
    );
    const epochProcess = allForks.beforeProcessEpoch(wrappedState);
    allForks.processJustificationAndFinalization(wrappedState as CachedBeaconState<allForks.BeaconState>, epochProcess);
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
