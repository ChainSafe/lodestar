/* eslint-disable @typescript-eslint/camelcase */
import {join} from "path";
import {expect} from "chai";
import {equals} from "@chainsafe/ssz";
import {config,IBeaconConfig} from "@chainsafe/eth2.0-config/lib/presets/minimal";
import {BeaconState, Deposit, Hash, uint64} from "@chainsafe/eth2.0-types";
import {describeDirectorySpecTest, InputType} from "@chainsafe/eth2.0-spec-test-util/lib/single";
import {initializeBeaconStateFromEth1} from "../../../../src/chain/genesis/genesis";

import {SPEC_TEST_LOCATION} from "../../../utils/specTestCases";

interface IGenesisInitSpecTest {
  eth1_block_hash: Hash;
  eth1_timestamp: uint64;
  meta: {
    depositsCount: uint64;
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
      eth1_block_hash: config.types.Hash,
      state: config.types.BeaconState,
      ...generateDepositSSZTypeMapping(192, config)
    },
    timeout: 60000,
    getExpected: (testCase => testCase.state),
    expectFunc: (testCase, expected, actual) => {
      expect(equals(config.types.BeaconState, actual, expected)).to.be.true;
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
