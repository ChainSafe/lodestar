/* eslint-disable @typescript-eslint/naming-convention */
import {join} from "path";
import {expect} from "chai";
import {altair, ssz} from "@chainsafe/lodestar-types";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util";
import {isValidGenesisState} from "@chainsafe/lodestar-beacon-state-transition";
import {ACTIVE_PRESET} from "@chainsafe/lodestar-params";
import {SPEC_TEST_LOCATION} from "../../../utils/specTestCases";
import {IBaseSpecTest} from "../../type";
import {config} from "../util";

interface IGenesisValidityTestCase extends IBaseSpecTest {
  is_valid: boolean;
  genesis: altair.BeaconState;
}

describeDirectorySpecTest<IGenesisValidityTestCase, boolean>(
  `${ACTIVE_PRESET}/altair/genesis/validity`,
  join(SPEC_TEST_LOCATION, `tests/${ACTIVE_PRESET}/altair/genesis/validity/pyspec_tests`),
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
      genesis: ssz.altair.BeaconState,
    },
    getExpected: (testCase) => testCase.is_valid,
    expectFunc: (testCase, expected, actual) => {
      expect(actual).to.be.equal(expected, "isValidGenesisState is not" + expected);
    },
  }
);
