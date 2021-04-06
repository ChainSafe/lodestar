import {join} from "path";
import {expect} from "chai";

import {TreeBacked} from "@chainsafe/ssz";
import {allForks} from "@chainsafe/lodestar-types";
import {config} from "@chainsafe/lodestar-config/mainnet";
import {CachedBeaconState, fast, phase0} from "@chainsafe/lodestar-beacon-state-transition";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util";
import {IProcessBlockHeader} from "./type";
import {SPEC_TEST_LOCATION} from "../../../utils/specTestCases";

describeDirectorySpecTest<IProcessBlockHeader, phase0.BeaconState>(
  "process block header mainnet",
  join(SPEC_TEST_LOCATION, "/tests/mainnet/phase0/operations/block_header/pyspec_tests"),
  (testcase) => {
    const wrappedState = fast.createCachedBeaconState<phase0.BeaconState>(
      config,
      testcase.pre as TreeBacked<phase0.BeaconState>
    );
    fast.processBlockHeader(wrappedState as CachedBeaconState<allForks.BeaconState>, testcase.block);
    return wrappedState;
  },
  {
    inputTypes: {
      pre: {
        type: InputType.SSZ,
        treeBacked: true,
      },
      post: {
        type: InputType.SSZ,
        treeBacked: true,
      },
    },
    sszTypes: {
      pre: config.types.phase0.BeaconState,
      post: config.types.phase0.BeaconState,
      block: config.types.phase0.BeaconBlock,
    },
    timeout: 100000000,
    shouldError: (testCase) => !testCase.post,
    getExpected: (testCase) => testCase.post,
    expectFunc: (testCase, expected, actual) => {
      expect(config.types.phase0.BeaconState.equals(actual, expected)).to.be.true;
    },
  }
);
