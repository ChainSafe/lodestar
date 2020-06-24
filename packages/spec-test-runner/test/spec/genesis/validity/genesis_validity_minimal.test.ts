/* eslint-disable @typescript-eslint/camelcase */
import {join} from "path";

import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import {BeaconState} from "@chainsafe/lodestar-types";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util/lib/single";
import {isValidGenesisState} from "@chainsafe/lodestar/lib/chain/genesis/util";
import {SPEC_TEST_LOCATION} from "../../../utils/specTestCases";

interface IGenesisValidityTestCase {
  is_valid: boolean;
  genesis: BeaconState;
}

describeDirectorySpecTest<IGenesisValidityTestCase, boolean>(
  "genesis initialization",
  join(SPEC_TEST_LOCATION, "tests/minimal/phase0/genesis/validity/pyspec_tests"),
  (testcase) => {
    return isValidGenesisState(config, testcase.genesis);
  },
  {
    inputTypes: {
      is_valid: InputType.YAML,
      genesis: InputType.SSZ
    },
    // @ts-ignore
    sszTypes: {
      genesis: config.types.BeaconState
    },
    getExpected: (testCase => testCase.is_valid)
  }
);

