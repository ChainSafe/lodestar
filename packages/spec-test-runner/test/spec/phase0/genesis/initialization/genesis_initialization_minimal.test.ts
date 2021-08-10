/* eslint-disable @typescript-eslint/naming-convention */
import {join} from "path";
import {config} from "@chainsafe/lodestar-config/default";
import {phase0, Uint64, Root, ssz} from "@chainsafe/lodestar-types";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util";
import {initializeBeaconStateFromEth1} from "@chainsafe/lodestar-beacon-state-transition";

import {SPEC_TEST_LOCATION} from "../../../../utils/specTestCases";
import {expectEqualBeaconStatePhase0} from "../../../util";

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
    return initializeBeaconStateFromEth1(
      config,
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      ssz.Root.fromJson(testcase.eth1.eth1BlockHash),
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      Number(testcase.eth1.eth1Timestamp),
      deposits
    ) as phase0.BeaconState;
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
      state: ssz.phase0.BeaconState,
      ...generateDepositSSZTypeMapping(192),
    },
    timeout: 60000,
    getExpected: (testCase) => testCase.state,
    expectFunc: (testCase, expected, actual) => {
      expectEqualBeaconStatePhase0(expected, actual);
    },
    //shouldSkip: (_, __, index) => index !== 0,
  }
);

function generateDepositSSZTypeMapping(n: number): Record<string, typeof ssz.phase0.Deposit> {
  const depositMappings: Record<string, typeof ssz.phase0.Deposit> = {};
  for (let i = 0; i < n; i++) {
    depositMappings[`deposits_${i}`] = ssz.phase0.Deposit;
  }
  return depositMappings;
}
