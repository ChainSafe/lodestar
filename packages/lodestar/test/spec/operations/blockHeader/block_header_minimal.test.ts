import {join} from "path";
import {expect} from "chai";
// @ts-ignore
import {equals} from "@chainsafe/ssz";
import {config} from "@chainsafe/eth2.0-config/lib/presets/minimal";
import {BeaconState} from "@chainsafe/eth2.0-types";
import {describeDirectorySpecTest} from "@chainsafe/eth2.0-spec-test-util/lib/single";
import {ProcessBlockHeader} from "./type";
import {processBlockHeader} from "../../../../src/chain/stateTransition/block/blockHeader";
import {SPEC_TEST_LOCATION} from "../../../utils/specTestCases";

describeDirectorySpecTest<ProcessBlockHeader, BeaconState>(
  "process block header minimal",
  join(SPEC_TEST_LOCATION, "/tests/minimal/phase0/operations/block_header/pyspec_tests"),
  (testcase) => {
    const state = testcase.pre;
    processBlockHeader(config, state, testcase.block);
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
      expect(equals(actual, expected, config.types.BeaconState)).to.be.true;
    }
  }
);

