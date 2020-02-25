/* eslint-disable @typescript-eslint/camelcase */
import {join} from "path";
import {expect} from "chai";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {BeaconState, Deposit, Uint64, Root} from "@chainsafe/lodestar-types";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util/lib/single";
import {initializeBeaconStateFromEth1} from "@chainsafe/lodestar/lib/chain/genesis/genesis";

import {SPEC_TEST_LOCATION} from "../../../utils/specTestCases";

interface IGenesisInitSpecTest {
  eth1_block_hash: Root;
  eth1_timestamp: Uint64;
  meta: {
    depositsCount: Uint64;
  };
  state: BeaconState;
  [k: string]: Deposit|unknown|null|undefined;
}

describeDirectorySpecTest<IGenesisInitSpecTest, BeaconState>(
  "genesis initialization",
  join(SPEC_TEST_LOCATION, "/tests/minimal/phase0/genesis/initialization/pyspec_tests"),
  (testcase) => {
    const deposits: Deposit[] = [];
    for(let i= 0; i < Number(testcase.meta.depositsCount); i++) {
      deposits.push(testcase[`deposits_${i}`] as Deposit);
    }
    return initializeBeaconStateFromEth1(config, testcase.eth1_block_hash, Number(testcase.eth1_timestamp), deposits);
  },
  {
    // @ts-ignore
    inputTypes: {
      meta: InputType.YAML,
      eth1_timestamp: InputType.YAML
    },
    // @ts-ignore
    sszTypes: {
      eth1_block_hash: config.types.Root,
      state: config.types.BeaconState,
      ...generateDepositSSZTypeMapping(192, config)
    },
    timeout: 60000,
    getExpected: (testCase => testCase.state),
    expectFunc: (testCase, expected, actual) => {
      expect(config.types.BeaconState.equals(actual, expected)).to.be.true;
    }
  }
);

function generateDepositSSZTypeMapping(n: number, config: IBeaconConfig): object {
  const depositMappings = {};
  for(let i = 0; i<n; i++) {
    depositMappings[`deposits_${i}`] = config.types.Deposit;
  }
  return depositMappings;
}
