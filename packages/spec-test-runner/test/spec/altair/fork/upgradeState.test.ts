import {join} from "path";

import {TreeBacked} from "@chainsafe/ssz";
import {config} from "@chainsafe/lodestar-config/minimal";
import {allForks, altair, phase0} from "@chainsafe/lodestar-beacon-state-transition";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util";
import {IUpgradeStateCase} from "./type";
import {upgradeState} from "@chainsafe/lodestar-beacon-state-transition/lib/altair";
import {SPEC_TEST_LOCATION} from "../../../utils/specTestCases";
import {expectEqualBeaconState} from "../util";

describeDirectorySpecTest<IUpgradeStateCase, altair.BeaconState>(
  "upgrade state to altair",
  join(SPEC_TEST_LOCATION, "/tests/minimal/altair/fork/fork/pyspec_tests"),
  (testcase) => {
    const phase0State = allForks.createCachedBeaconState<phase0.BeaconState>(
      config,
      testcase.pre as TreeBacked<phase0.BeaconState>
    );
    return upgradeState(phase0State);
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
      meta: InputType.YAML,
    },
    sszTypes: {
      pre: config.types.phase0.BeaconState,
      post: config.types.altair.BeaconState,
    },

    timeout: 10000,
    shouldError: (testCase) => !testCase.post,
    getExpected: (testCase) => testCase.post,
    expectFunc: (testCase, expected, actual) => {
      expectEqualBeaconState(config, expected, actual);
    },
  }
);
