import {join} from "path";
import {params} from "@chainsafe/lodestar-params/minimal";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util";
import {IProcessSlotsTestCase} from "./type";
import {SPEC_TEST_LOCATION} from "../../../../utils/specTestCases";
import {altair, allForks} from "@chainsafe/lodestar-beacon-state-transition";
import {TreeBacked} from "@chainsafe/ssz";
import {createIBeaconConfig} from "@chainsafe/lodestar-config";
import {expectEqualBeaconState} from "../../util";
import {ssz} from "@chainsafe/lodestar-types";

// eslint-disable-next-line @typescript-eslint/naming-convention
const config = createIBeaconConfig({...params, ALTAIR_FORK_EPOCH: 0});

describeDirectorySpecTest<IProcessSlotsTestCase, altair.BeaconState>(
  "altair slot sanity minimal",
  join(SPEC_TEST_LOCATION, "/tests/minimal/altair/sanity/slots/pyspec_tests"),
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
      expectEqualBeaconState(config, expected, actual);
    },
  }
);
