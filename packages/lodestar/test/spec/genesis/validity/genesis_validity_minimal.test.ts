/* eslint-disable @typescript-eslint/camelcase */
import {join} from "path";

import {config} from "@chainsafe/eth2.0-config/lib/presets/minimal";
import {isValidGenesisState} from "../../../../src/chain/genesis/genesis";
import {BeaconState} from "@chainsafe/eth2.0-types";
import {describeDirectorySpecTest, InputType} from "@chainsafe/eth2.0-spec-test-util/lib/single";
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

