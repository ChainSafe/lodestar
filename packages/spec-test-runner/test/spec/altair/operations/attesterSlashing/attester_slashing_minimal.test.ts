import {join} from "path";

import {TreeBacked} from "@chainsafe/ssz";
import {params} from "@chainsafe/lodestar-params/minimal";
import {allForks, altair} from "@chainsafe/lodestar-beacon-state-transition";
import {createIBeaconConfig} from "@chainsafe/lodestar-config";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util";
import {IProcessAttesterSlashingTestCase} from "./type";
import {SPEC_TEST_LOCATION} from "../../../../utils/specTestCases";
import {expectEqualBeaconState} from "../../util";
import {ssz} from "@chainsafe/lodestar-types";

// eslint-disable-next-line @typescript-eslint/naming-convention
const config = createIBeaconConfig({...params, ALTAIR_FORK_EPOCH: 0});

describeDirectorySpecTest<IProcessAttesterSlashingTestCase, altair.BeaconState>(
  "process attester slashing minimal",
  join(SPEC_TEST_LOCATION, "/tests/minimal/altair/operations/attester_slashing/pyspec_tests"),
  (testcase) => {
    const wrappedState = allForks.createCachedBeaconState<altair.BeaconState>(
      config,
      testcase.pre as TreeBacked<altair.BeaconState>
    );
    const verify = !!testcase.meta && !!testcase.meta.blsSetting && testcase.meta.blsSetting === BigInt(1);
    altair.processAttesterSlashing(wrappedState, testcase.attester_slashing, verify);
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
      meta: InputType.YAML,
    },
    sszTypes: {
      pre: ssz.altair.BeaconState,
      post: ssz.altair.BeaconState,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      attester_slashing: ssz.phase0.AttesterSlashing,
    },
    timeout: 10000,
    shouldError: (testCase) => !testCase.post,
    getExpected: (testCase) => testCase.post,
    expectFunc: (testCase, expected, actual) => {
      expectEqualBeaconState(config, expected, actual);
    },
  }
);
