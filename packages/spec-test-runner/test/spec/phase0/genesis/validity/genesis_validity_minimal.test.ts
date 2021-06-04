/* eslint-disable @typescript-eslint/naming-convention */
import {join} from "path";

import {config} from "@chainsafe/lodestar-config/default";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util";
import {phase0, isValidGenesisState} from "@chainsafe/lodestar-beacon-state-transition";
import {SPEC_TEST_LOCATION} from "../../../../utils/specTestCases";
import {IBaseSpecTest} from "../../../type";
import {ssz} from "@chainsafe/lodestar-types";

interface IGenesisValidityTestCase extends IBaseSpecTest {
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
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    sszTypes: {
      genesis: ssz.phase0.BeaconState,
    },
    getExpected: (testCase) => testCase.is_valid,
  }
);
