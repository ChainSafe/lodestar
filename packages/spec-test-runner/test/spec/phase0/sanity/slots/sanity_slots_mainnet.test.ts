import {join} from "path";
import {expect} from "chai";

import {TreeBacked} from "@chainsafe/ssz";
import {config} from "@chainsafe/lodestar-config/mainnet";
import {allForks, phase0} from "@chainsafe/lodestar-beacon-state-transition";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util";
import {IProcessSlotsTestCase} from "./type";
import {SPEC_TEST_LOCATION} from "../../../../utils/specTestCases";
import {BeaconState} from "@chainsafe/lodestar-types/phase0";

describeDirectorySpecTest<IProcessSlotsTestCase, phase0.BeaconState>(
  "slot sanity mainnet",
  join(SPEC_TEST_LOCATION, "/tests/mainnet/phase0/sanity/slots/pyspec_tests"),
  (testcase) => {
    const wrappedState = allForks.createCachedBeaconState<phase0.BeaconState>(
      config,
      testcase.pre as TreeBacked<phase0.BeaconState>
    );
    phase0.processSlots(wrappedState, wrappedState.slot + Number(testcase.slots));
    return wrappedState;
  },
  {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    inputTypes: {
      pre: {
        type: InputType.SSZ_SNAPPY,
        treeBacked: true,
      },
      post: {
        type: InputType.SSZ_SNAPPY,
        treeBacked: true,
      },
      slots: InputType.YAML,
    },
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    sszTypes: {
      pre: config.types.phase0.BeaconState,
      post: config.types.phase0.BeaconState,
    },
    shouldError: (testCase) => {
      return !testCase.post;
    },
    timeout: 10000000,
    getExpected: (testCase) => testCase.post as BeaconState,
    expectFunc: (testCase, expected, actual) => {
      expect(config.types.phase0.BeaconState.equals(actual, expected)).to.be.true;
    },
  }
);
