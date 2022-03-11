import {join} from "node:path";
import {expect} from "chai";
import {phase0, Uint64, Root, ssz, allForks, bellatrix} from "@chainsafe/lodestar-types";
import {TreeBacked} from "@chainsafe/ssz";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util";
import {initializeBeaconStateFromEth1, isValidGenesisState} from "@chainsafe/lodestar-beacon-state-transition";
import {bnToNum} from "@chainsafe/lodestar-utils";
import {ACTIVE_PRESET, ForkName} from "@chainsafe/lodestar-params";
import {SPEC_TEST_LOCATION} from "../specTestVersioning";
import {expectEqualBeaconState} from "../util";
import {IBaseSpecTest} from "../type";
import {getConfig} from "./util";

/* eslint-disable @typescript-eslint/naming-convention */

export function genesis(fork: ForkName): void {
  describeDirectorySpecTest<IGenesisInitSpecTest, phase0.BeaconState>(
    `${ACTIVE_PRESET}/${fork}/genesis/initialization`,
    join(SPEC_TEST_LOCATION, `/tests/${ACTIVE_PRESET}/${fork}/genesis/initialization/pyspec_tests`),
    (testcase) => {
      const deposits: phase0.Deposit[] = [];
      for (let i = 0; i < testcase.meta.deposits_count; i++) {
        deposits.push(testcase[`deposits_${i}`] as phase0.Deposit);
      }
      let executionPayloadHeader: TreeBacked<bellatrix.ExecutionPayloadHeader> | undefined = undefined;
      if (testcase["execution_payload_header"]) {
        executionPayloadHeader = ssz.bellatrix.ExecutionPayloadHeader.createTreeBackedFromStruct(
          testcase["execution_payload_header"]
        );
      }
      return initializeBeaconStateFromEth1(
        getConfig(fork),
        ssz.Root.fromJson((testcase.eth1 as IGenesisInitCase).eth1_block_hash),
        bnToNum((testcase.eth1 as IGenesisInitCase).eth1_timestamp),
        deposits,
        undefined,
        executionPayloadHeader
      ) as phase0.BeaconState;
    },
    {
      inputTypes: {meta: InputType.YAML, eth1: InputType.YAML},
      sszTypes: {
        eth1_block_hash: ssz.Root,
        state: ssz[fork].BeaconState,
        // for merge genesis, no affect on other phases
        execution_payload_header: ssz["bellatrix"].ExecutionPayloadHeader,
        ...generateDepositSSZTypeMapping(192),
      },
      timeout: 60000,
      getExpected: (testCase) => testCase.state,
      expectFunc: (testCase, expected, actual) => {
        expectEqualBeaconState(fork, expected, actual);
      },
    }
  );

  describeDirectorySpecTest<IGenesisValidityTestCase, boolean>(
    `${ACTIVE_PRESET}/${fork}/genesis/validity`,
    join(SPEC_TEST_LOCATION, `tests/${ACTIVE_PRESET}/${fork}/genesis/validity/pyspec_tests`),
    (testcase) => {
      return isValidGenesisState(getConfig(fork), testcase.genesis);
    },
    {
      inputTypes: {
        is_valid: InputType.YAML,
        genesis: InputType.SSZ_SNAPPY,
      },
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      sszTypes: {
        genesis: ssz[fork].BeaconState,
      },
      getExpected: (testCase) => testCase.is_valid,
      expectFunc: (testCase, expected, actual) => {
        expect(actual).to.be.equal(expected, "isValidGenesisState is not" + expected);
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

interface IGenesisInitSpecTest {
  [k: string]: phase0.Deposit | unknown | null | undefined;
  eth1_block_hash: Root;
  eth1_timestamp: Uint64;
  meta: {
    deposits_count: number;
  };
  execution_payload_header?: bellatrix.ExecutionPayloadHeader;
  state: phase0.BeaconState;
}

interface IGenesisInitCase {
  eth1_block_hash: string;
  eth1_timestamp: bigint;
}

interface IGenesisValidityTestCase extends IBaseSpecTest {
  is_valid: boolean;
  genesis: allForks.BeaconState;
}
