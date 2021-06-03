import {join} from "path";
import {expect} from "chai";

import {TreeBacked} from "@chainsafe/ssz";
import {config} from "@chainsafe/lodestar-config/mainnet";
import {CachedBeaconState, allForks, phase0} from "@chainsafe/lodestar-beacon-state-transition";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util";
import {IProcessBlockHeader} from "./type";
import {SPEC_TEST_LOCATION} from "../../../../utils/specTestCases";
import {ssz} from "@chainsafe/lodestar-types";

describeDirectorySpecTest<IProcessBlockHeader, phase0.BeaconState>(
  "process block header mainnet",
  join(SPEC_TEST_LOCATION, "/tests/mainnet/phase0/operations/block_header/pyspec_tests"),
  (testcase) => {
    const wrappedState = allForks.createCachedBeaconState<phase0.BeaconState>(
      config,
      testcase.pre as TreeBacked<phase0.BeaconState>
    );
    allForks.processBlockHeader(wrappedState as CachedBeaconState<allForks.BeaconState>, testcase.block);
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
      block: ssz.phase0.BeaconBlock,
    },
    timeout: 100000000,
    shouldError: (testCase) => !testCase.post,
    getExpected: (testCase) => testCase.post,
    expectFunc: (testCase, expected, actual) => {
      expect(ssz.phase0.BeaconState.equals(actual, expected)).to.be.true;
    },
  }
);
