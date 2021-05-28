/* eslint-disable @typescript-eslint/naming-convention */
import {join} from "path";

import {createIBeaconConfig} from "@chainsafe/lodestar-config";
import {params} from "@chainsafe/lodestar-params/minimal";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util";
import {altair, isValidGenesisState} from "@chainsafe/lodestar-beacon-state-transition";
import {SPEC_TEST_LOCATION} from "../../../../utils/specTestCases";
import {IBaseSpecTest} from "../../../type";

interface IGenesisValidityTestCase extends IBaseSpecTest {
  is_valid: boolean;
  genesis: altair.BeaconState;
}

// eslint-disable-next-line @typescript-eslint/naming-convention
const config = createIBeaconConfig({...params, ALTAIR_FORK_EPOCH: 0});

describeDirectorySpecTest<IGenesisValidityTestCase, boolean>(
  "genesis validity",
  join(SPEC_TEST_LOCATION, "tests/minimal/altair/genesis/validity/pyspec_tests"),
  (testcase) => {
    return isValidGenesisState(config, testcase.genesis);
  },
  {
    inputTypes: {
      is_valid: InputType.YAML,
      genesis: InputType.SSZ_SNAPPY,
    },
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    sszTypes: {
      genesis: config.types.altair.BeaconState,
    },
    getExpected: (testCase) => testCase.is_valid,
  }
);
