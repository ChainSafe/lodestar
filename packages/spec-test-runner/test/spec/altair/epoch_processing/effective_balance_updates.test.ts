import {join} from "path";
import {expect} from "chai";

import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util";
import {altair, CachedBeaconState, allForks} from "@chainsafe/lodestar-beacon-state-transition";
import {altair as altairTypes, ssz} from "@chainsafe/lodestar-types";
import {SPEC_TEST_LOCATION} from "../../../../utils/specTestCases";
import {IAltairStateTestCase} from "../../stateTestCase";
import {TreeBacked} from "@chainsafe/ssz";
import {createIChainForkConfig} from "@chainsafe/lodestar-config";
import {ACTIVE_PRESET} from "@chainsafe/lodestar-params";

// eslint-disable-next-line @typescript-eslint/naming-convention
const config = createIChainForkConfig({ALTAIR_FORK_EPOCH: 0});

describeDirectorySpecTest<IAltairStateTestCase, altairTypes.BeaconState>(
  `altair epoch effective balance updates ${ACTIVE_PRESET}`,
  join(SPEC_TEST_LOCATION, `tests/${ACTIVE_PRESET}/altair/epoch_processing/effective_balance_updates/pyspec_tests`),
  (testcase) => {
    const wrappedState = allForks.createCachedBeaconState<altair.BeaconState>(
      config,
      (testcase.pre as TreeBacked<altair.BeaconState>).clone()
    );
    const epochProcess = allForks.beforeProcessEpoch(wrappedState);
    allForks.processEffectiveBalanceUpdates(wrappedState as CachedBeaconState<allForks.BeaconState>, epochProcess);
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
    },
    getExpected: (testCase) => testCase.post,
    expectFunc: (testCase, expected, actual) => {
      expect(ssz.altair.BeaconState.equals(actual, expected)).to.be.true;
    },
  }
);
