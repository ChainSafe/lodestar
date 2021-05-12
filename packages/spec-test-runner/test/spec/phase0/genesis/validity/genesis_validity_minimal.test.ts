/* eslint-disable @typescript-eslint/naming-convention */
import {join} from "path";

import {config} from "@chainsafe/lodestar-config/minimal";
import {phase0} from "@chainsafe/lodestar-types";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util";
import {isValidGenesisState} from "@chainsafe/lodestar-beacon-state-transition";
import {SPEC_TEST_LOCATION} from "../../../../utils/specTestCases";

interface IGenesisValidityTestCase {
  is_valid: boolean;
  genesis: phase0.BeaconState;
}

describeDirectorySpecTest<IGenesisValidityTestCase, boolean>(
  "genesis validity",
  join(SPEC_TEST_LOCATION, "tests/minimal/phase0/genesis/validity/pyspec_tests"),
  (testcase) => {
    return isValidGenesisState(config, testcase.genesis);
  },
  {
    inputTypes: {
      is_valid: InputType.YAML,
      genesis: InputType.SSZ_SNAPPY,
    },
    // @ts-ignore
    sszTypes: {
      genesis: config.types.phase0.BeaconState,
    },
    getExpected: (testCase) => testCase.is_valid,
  }
);
