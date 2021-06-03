import {join} from "path";

import {TreeBacked} from "@chainsafe/ssz";
import {createIBeaconConfig} from "@chainsafe/lodestar-config";
import {allForks, altair} from "@chainsafe/lodestar-beacon-state-transition";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util";
import {IProcessVoluntaryExitTestCase} from "./type";
import {SPEC_TEST_LOCATION} from "../../../../utils/specTestCases";
import {expectEqualBeaconState} from "../../util";
import {ssz} from "@chainsafe/lodestar-types";

// eslint-disable-next-line @typescript-eslint/naming-convention
const config = createIBeaconConfig({ALTAIR_FORK_EPOCH: 0});

describeDirectorySpecTest<IProcessVoluntaryExitTestCase, altair.BeaconState>(
  "process voluntary exit minimal",
  join(SPEC_TEST_LOCATION, "/tests/minimal/altair/operations/voluntary_exit/pyspec_tests"),
  (testcase) => {
    const wrappedState = allForks.createCachedBeaconState<altair.BeaconState>(
      config,
      testcase.pre as TreeBacked<altair.BeaconState>
    );
    altair.processVoluntaryExit(wrappedState, testcase.voluntary_exit);
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
      pre: ssz.altair.BeaconState,
      post: ssz.altair.BeaconState,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      voluntary_exit: ssz.phase0.SignedVoluntaryExit,
    },
    timeout: 10000,
    shouldError: (testCase) => !testCase.post,
    getExpected: (testCase) => testCase.post,
    expectFunc: (testCase, expected, actual) => {
      expectEqualBeaconState(config, expected, actual);
    },
  }
);
