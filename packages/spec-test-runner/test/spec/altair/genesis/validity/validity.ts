/* eslint-disable @typescript-eslint/naming-convention */
import {join} from "path";

import {createIBeaconConfig} from "@chainsafe/lodestar-config";
import {altair, ssz} from "@chainsafe/lodestar-types";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util";
import {isValidGenesisState} from "@chainsafe/lodestar-beacon-state-transition";
import {SPEC_TEST_LOCATION} from "../../../../utils/specTestCases";
import {IBaseSpecTest} from "../../../type";
import {expect} from "chai";
import {PresetName} from "@chainsafe/lodestar-params";

interface IGenesisValidityTestCase extends IBaseSpecTest {
  is_valid: boolean;
  genesis: altair.BeaconState;
}

export function runValidity(presetName: PresetName): void {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const config = createIBeaconConfig({ALTAIR_FORK_EPOCH: 0});

  describeDirectorySpecTest<IGenesisValidityTestCase, boolean>(
    `genesis validity ${presetName}`,
    join(SPEC_TEST_LOCATION, `tests/${presetName}/altair/genesis/validity/pyspec_tests`),
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
}
