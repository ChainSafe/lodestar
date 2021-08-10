/* eslint-disable @typescript-eslint/naming-convention */
import {join} from "path";
import {createIChainForkConfig} from "@chainsafe/lodestar-config";
import {altair, Uint64, Root, ssz} from "@chainsafe/lodestar-types";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util";
import {initializeBeaconStateFromEth1} from "@chainsafe/lodestar-beacon-state-transition";

import {SPEC_TEST_LOCATION} from "../../../../utils/specTestCases";
import {expectEqualBeaconStateAltair} from "../../../util";
import {PresetName} from "@chainsafe/lodestar-params";

interface IGenesisInitSpecTest {
  [k: string]: altair.Deposit | unknown | null | undefined;
  eth1_block_hash: Root;
  eth1_timestamp: Uint64;
  meta: {
    depositsCount: Uint64;
  };
  state: altair.BeaconState;
}

export function runInitialization(presetName: PresetName): void {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const config = createIChainForkConfig({ALTAIR_FORK_EPOCH: 0});

  describeDirectorySpecTest<IGenesisInitSpecTest, altair.BeaconState>(
    `genesis initialization ${presetName}`,
    join(SPEC_TEST_LOCATION, `/tests/${presetName}/altair/genesis/initialization/pyspec_tests`),
    (testcase) => {
      const deposits: altair.Deposit[] = [];
      for (let i = 0; i < Number(testcase.meta.depositsCount); i++) {
        deposits.push(testcase[`deposits_${i}`] as altair.Deposit);
      }
      return initializeBeaconStateFromEth1(
        config,
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        ssz.Root.fromJson(testcase.eth1.eth1BlockHash),
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
        eth1_block_hash: ssz.Root,
        state: ssz.altair.BeaconState,
        ...generateDepositSSZTypeMapping(192),
      },
      timeout: 10000,
      getExpected: (testCase) => testCase.state,
      expectFunc: (testCase, expected, actual) => {
        expectEqualBeaconStateAltair(expected, actual);
      },
    }
  );
}

function generateDepositSSZTypeMapping(n: number): Record<string, typeof ssz.phase0.Deposit> {
  const depositMappings: Record<string, typeof ssz.phase0.Deposit> = {};
  for (let i = 0; i < n; i++) {
    depositMappings[`deposits_${i}`] = ssz.phase0.Deposit;
  }
  return depositMappings;
}
