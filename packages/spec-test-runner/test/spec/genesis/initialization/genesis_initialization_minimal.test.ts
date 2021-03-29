/* eslint-disable @typescript-eslint/naming-convention */
import {join} from "path";
import {expect} from "chai";
import {config} from "@chainsafe/lodestar-config/minimal";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {phase0, Uint64, Root} from "@chainsafe/lodestar-types";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util";
import {initializeBeaconStateFromEth1} from "@chainsafe/lodestar-beacon-state-transition";

import {SPEC_TEST_LOCATION} from "../../../utils/specTestCases";

interface IGenesisInitSpecTest {
  [k: string]: phase0.Deposit | unknown | null | undefined;
  eth1_block_hash: Root;
  eth1_timestamp: Uint64;
  meta: {
    depositsCount: Uint64;
  };
  state: phase0.BeaconState;
}

describeDirectorySpecTest<IGenesisInitSpecTest, phase0.BeaconState>(
  "genesis initialization",
  join(SPEC_TEST_LOCATION, "/tests/minimal/phase0/genesis/initialization/pyspec_tests"),
  (testcase) => {
    const deposits: phase0.Deposit[] = [];
    for (let i = 0; i < Number(testcase.meta.depositsCount); i++) {
      deposits.push(testcase[`deposits_${i}`] as phase0.Deposit);
    }
    return initializeBeaconStateFromEth1(config, testcase.eth1_block_hash, Number(testcase.eth1_timestamp), deposits);
  },
  {
    // @ts-ignore
    inputTypes: {
      meta: InputType.YAML,
      eth1_timestamp: InputType.YAML,
    },
    // @ts-ignore
    sszTypes: {
      eth1_block_hash: config.types.Root,
      state: config.types.phase0.BeaconState,
      ...generateDepositSSZTypeMapping(192, config),
    },
    timeout: 60000,
    getExpected: (testCase) => testCase.state,
    expectFunc: (testCase, expected, actual) => {
      expect(config.types.phase0.BeaconState.equals(actual, expected)).to.be.true;
    },
    //shouldSkip: (_, __, index) => index !== 0,
  }
);

function generateDepositSSZTypeMapping(
  n: number,
  config: IBeaconConfig
): Record<string, typeof config.types.phase0.Deposit> {
  const depositMappings: Record<string, typeof config.types.phase0.Deposit> = {};
  for (let i = 0; i < n; i++) {
    depositMappings[`deposits_${i}`] = config.types.phase0.Deposit;
  }
  return depositMappings;
}
