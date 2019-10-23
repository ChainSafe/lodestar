import {join} from "path";
import {expect} from "chai";
// @ts-ignore
import {equals} from "@chainsafe/ssz";

import {BeaconState} from "@chainsafe/eth2.0-types";
import {config} from "@chainsafe/eth2.0-config/lib/presets/minimal";
import {processTransfer} from "@chainsafe/eth2.0-state-transition";
import {describeDirectorySpecTest} from "@chainsafe/eth2.0-spec-test-util/lib/single";
import {ProcessTransferTestCase} from "./type";
import {SPEC_TEST_LOCATION} from "../../../utils/specTestCases";

describeDirectorySpecTest<ProcessTransferTestCase, BeaconState>(
  "process transfer minimal",
  join(SPEC_TEST_LOCATION, "/tests/minimal/phase0/operations/transfer/pyspec_tests"),
  (testcase) => {
    const state = testcase.pre;
    processTransfer(config, state, testcase.transfer);
    return state;
  },
  {
    sszTypes: {
      pre: config.types.BeaconState,
      post: config.types.BeaconState,
      transfer: config.types.Transfer,
    },
    timeout: 100000000,
    shouldError: testCase => !testCase.post,
    getExpected: (testCase => testCase.post),
    expectFunc: (testCase, expected, actual) => {
      expect(equals(actual, expected, config.types.BeaconState)).to.be.true;
    }
  }
);


