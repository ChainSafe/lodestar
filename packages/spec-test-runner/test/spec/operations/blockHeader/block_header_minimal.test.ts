import {join} from "path";
import {expect} from "chai";
import {equals} from "@chainsafe/ssz";
import {config} from "@chainsafe/eth2.0-config/lib/presets/minimal";
import {BeaconState} from "@chainsafe/eth2.0-types";
import {describeDirectorySpecTest} from "@chainsafe/eth2.0-spec-test-util/lib/single";
import {IProcessBlockHeader} from "./type";
import {processBlockHeader} from "@chainsafe/eth2.0-state-transition";
import {SPEC_TEST_LOCATION} from "../../../utils/specTestCases";

describeDirectorySpecTest<IProcessBlockHeader, BeaconState>(
  "process block header minimal",
  join(SPEC_TEST_LOCATION, "/tests/minimal/phase0/operations/block_header/pyspec_tests"),
  (testcase) => {
    const state = testcase.pre;
    const verify = (!!testcase.meta && !!testcase.meta.blsSetting && testcase.meta.blsSetting === 1n);
    processBlockHeader(config, state, testcase.block, verify);
    return state;
  },
  {
    sszTypes: {
      pre: config.types.BeaconState,
      post: config.types.BeaconState,
      block: config.types.BeaconBlock,
    },
    timeout: 100000000,
    shouldError: testCase => !testCase.post,
    getExpected: (testCase => testCase.post),
    expectFunc: (testCase, expected, actual) => {
      expect(equals(config.types.BeaconState, actual, expected)).to.be.true;
    }
  }
);

