import {join} from "path";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util";
import {altair, allForks} from "@chainsafe/lodestar-beacon-state-transition";
import {TreeBacked} from "@chainsafe/ssz";
import {ssz, Uint64} from "@chainsafe/lodestar-types";
import {ACTIVE_PRESET} from "@chainsafe/lodestar-params";
import {expectEqualBeaconStateAltair} from "../../util";
import {SPEC_TEST_LOCATION} from "../../../utils/specTestCases";
import {IBaseSpecTest} from "../../type";
import {config} from "../util";

describeDirectorySpecTest<IProcessSlotsTestCase, altair.BeaconState>(
  `${ACTIVE_PRESET}/altair/sanity/slots`,
  join(SPEC_TEST_LOCATION, `/tests/${ACTIVE_PRESET}/altair/sanity/slots/pyspec_tests`),
  (testcase) => {
    const wrappedState = allForks.createCachedBeaconState<altair.BeaconState>(
      config,
      (testcase.pre as TreeBacked<altair.BeaconState>).clone()
    );
    const postState = allForks.processSlots(
      wrappedState as allForks.CachedBeaconState<allForks.BeaconState>,
      wrappedState.slot + Number(testcase.slots)
    );
    return postState.type.createTreeBacked(postState.tree) as altair.BeaconState;
  },
  {
    inputTypes: {
      pre: {type: InputType.SSZ_SNAPPY, treeBacked: true},
      post: {type: InputType.SSZ_SNAPPY, treeBacked: true},
      slots: InputType.YAML,
    },
    sszTypes: {
      pre: ssz.altair.BeaconState,
      post: ssz.altair.BeaconState,
    },
    shouldError: (testCase) => {
      return !testCase.post;
    },
    timeout: 10000,
    getExpected: (testCase) => testCase.post,
    expectFunc: (testCase, expected, actual) => {
      expectEqualBeaconStateAltair(expected, actual);
    },
  }
);

interface IProcessSlotsTestCase extends IBaseSpecTest {
  pre: altair.BeaconState;
  post?: altair.BeaconState;
  slots: Uint64;
}
