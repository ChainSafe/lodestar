/* eslint-disable @typescript-eslint/camelcase */
import {join} from "path";
import {expect} from "chai";
// @ts-ignore
import {equals} from "@chainsafe/ssz";

import {config} from "@chainsafe/eth2.0-config/lib/presets/minimal";
import {BeaconState, Deposit, Hash, number64, uint64} from "@chainsafe/eth2.0-types";
import {describeDirectorySpecTest, InputType} from "@chainsafe/eth2.0-spec-test-util/lib/single";
import {initializeBeaconStateFromEth1} from "../../../../src/chain/genesis/genesis";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {SPEC_TEST_LOCATION} from "../../../utils/specTestCases";

interface GenesisInitSpecTest {
  eth1_block_hash: Hash;
  eth1_timestamp: uint64;
  meta: {
    depositsCount: uint64;
  };
  state: BeaconState;
  [k: string]: Deposit|unknown|null|undefined;
}

// TODO: cannot load test for now, should resolve this test after upgrading Deposit to 0.9.0
// https://github.com/ChainSafe/lodestar/issues/534

// describeDirectorySpecTest<GenesisInitSpecTest, BeaconState>(
//   "genesis initialization",
//   join(SPEC_TEST_LOCATION, "/tests/minimal/phase0/genesis/initialization/pyspec_tests"),
//   (testcase) => {
//     const deposits: Deposit[] = [];
//     for(let i= 0; i < testcase.meta.depositsCount.toNumber(); i++) {
//       deposits.push(testcase[`deposits_${i}`] as Deposit);
//     }
//     return initializeBeaconStateFromEth1(config, testcase.eth1_block_hash, testcase.eth1_timestamp.toNumber(), deposits);
//   },
//   {
//     // @ts-ignore
//     inputTypes: {
//       meta: InputType.YAML,
//       eth1_timestamp: InputType.YAML
//     },
//     // @ts-ignore
//     sszTypes: {
//       eth1_block_hash: config.types.Hash,
//       state: config.types.BeaconState,
//       ...generateDepositSSZTypeMapping(64, config)
//     },
//     timeout: 60000,
//     getExpected: (testCase => testCase.state),
//     expectFunc: (testCase, expected, actual) => {
//       expect(equals(actual, expected, config.types.BeaconState)).to.be.true;
//     }
//   }
// );

// function generateDepositSSZTypeMapping(n: number, config: IBeaconConfig): object {
//   const depositMappings = {};
//   for(let i = 0; i<n; i++) {
//     depositMappings[`deposits_${i}`] = config.types.Deposit;
//   }
//   return depositMappings;
// }
