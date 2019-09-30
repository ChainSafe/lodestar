import {join} from "path";
import {expect} from "chai";
import {equals} from "@chainsafe/ssz";
import {config} from "@chainsafe/eth2.0-config/lib/presets/mainnet";
import {BeaconState} from "@chainsafe/eth2.0-types";
import {processSlots} from "../../../../src/chain/stateTransition";
import {describeDirectorySpecTest, InputType} from "@chainsafe/eth2.0-spec-test-util/lib/single";
import {ProcessSlotsTestCase} from "./type";
import {SPEC_TEST_LOCATION} from "../../../utils/specTestCases";

describeDirectorySpecTest<ProcessSlotsTestCase, BeaconState>(
  "slot sanity mainnet",
  join(SPEC_TEST_LOCATION, "/tests/mainnet/phase0/sanity/slots/pyspec_tests"),
  (testcase) => {
    const state = testcase.pre;
    processSlots(config, state, state.slot + testcase.slots.toNumber());
    return state;
  },
  {
    // @ts-ignore
    inputTypes: {
      slots: InputType.YAML
    },
    // @ts-ignore
    sszTypes: {
      pre: config.types.BeaconState,
      post: config.types.BeaconState,
    },
    shouldError: (testCase => {
      return !testCase.post;
    }),
    timeout: 10000000,
    getExpected: (testCase => testCase.post),
    expectFunc: (testCase, expected, actual) => {
      expect(equals(actual, expected, config.types.BeaconState)).to.be.true;
    }
  }
);

