import {join} from "path";
import {expect} from "chai";
import {config} from "@chainsafe/lodestar-config/mainnet";
import {phase0} from "@chainsafe/lodestar-beacon-state-transition";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util/lib/single";
import {IProcessSlotsTestCase} from "./type";
import {SPEC_TEST_LOCATION} from "../../../utils/specTestCases";

describeDirectorySpecTest<IProcessSlotsTestCase, phase0.BeaconState>(
  "slot sanity mainnet",
  join(SPEC_TEST_LOCATION, "/tests/mainnet/phase0/sanity/slots/pyspec_tests"),
  (testcase) => {
    const state = config.types.phase0.BeaconState.tree.createValue(testcase.pre);
    const epochCtx = new phase0.fast.EpochContext(config);
    epochCtx.loadState(state);
    const wrappedState = phase0.fast.createCachedValidatorsBeaconState(state);
    phase0.fast.processSlots(epochCtx, wrappedState, state.slot + Number(testcase.slots));
    return state;
  },
  {
    // @ts-ignore
    inputTypes: {
      slots: InputType.YAML,
    },
    // @ts-ignore
    sszTypes: {
      pre: config.types.phase0.BeaconState,
      post: config.types.phase0.BeaconState,
    },
    shouldError: (testCase) => {
      return !testCase.post;
    },
    timeout: 10000000,
    getExpected: (testCase) => testCase.post,
    expectFunc: (testCase, expected, actual) => {
      expect(config.types.phase0.BeaconState.equals(actual, expected)).to.be.true;
    },
  }
);
