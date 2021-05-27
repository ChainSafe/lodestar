/* eslint-disable @typescript-eslint/naming-convention */
import {join} from "path";
import {expect} from "chai";
import {params} from "@chainsafe/lodestar-params/minimal";
import {IBeaconConfig, createIBeaconConfig} from "@chainsafe/lodestar-config";
import {altair, Uint64, Root} from "@chainsafe/lodestar-types";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util";
import {initializeBeaconStateFromEth1} from "@chainsafe/lodestar-beacon-state-transition";

import {SPEC_TEST_LOCATION} from "../../../../utils/specTestCases";

interface IGenesisInitSpecTest {
  [k: string]: altair.Deposit | unknown | null | undefined;
  eth1_block_hash: Root;
  eth1_timestamp: Uint64;
  meta: {
    depositsCount: Uint64;
  };
  state: altair.BeaconState;
}

// eslint-disable-next-line @typescript-eslint/naming-convention
const config = createIBeaconConfig({...params, ALTAIR_FORK_EPOCH: 0});

describeDirectorySpecTest<IGenesisInitSpecTest, altair.BeaconState>(
  "genesis initialization",
  join(SPEC_TEST_LOCATION, "/tests/minimal/altair/genesis/initialization/pyspec_tests"),
  (testcase) => {
    const deposits: altair.Deposit[] = [];
    for (let i = 0; i < Number(testcase.meta.depositsCount); i++) {
      deposits.push(testcase[`deposits_${i}`] as altair.Deposit);
    }
    return initializeBeaconStateFromEth1(
      config,
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      config.types.Root.fromJson(testcase.eth1.eth1BlockHash),
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      Number(testcase.eth1.eth1Timestamp),
      deposits
    ) as altair.BeaconState;
  },
  {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    inputTypes: {
      meta: InputType.YAML,
      eth1: InputType.YAML,
    },
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    sszTypes: {
      eth1_block_hash: config.types.Root,
      state: config.types.altair.BeaconState,
      ...generateDepositSSZTypeMapping(192, config),
    },
    timeout: 60000,
    getExpected: (testCase) => testCase.state,
    expectFunc: (testCase, expected, actual) => {
      expect(config.types.altair.BeaconState.equals(actual, expected)).to.be.true;
    },
    // shouldSkip: (_, __, index) => index !== 0,
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
