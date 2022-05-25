import {expect} from "chai";
import {phase0, Root, ssz, bellatrix, TimeSeconds} from "@chainsafe/lodestar-types";
import {InputType} from "@chainsafe/lodestar-spec-test-util";
import {
  BeaconStateAllForks,
  createEmptyEpochContextImmutableData,
  initializeBeaconStateFromEth1,
  isValidGenesisState,
} from "@chainsafe/lodestar-beacon-state-transition";
import {bnToNum} from "@chainsafe/lodestar-utils";
import {expectEqualBeaconState} from "../utils/expectEqualBeaconState.js";
import {TestRunnerFn} from "../utils/types.js";
import {getConfig} from "../utils/getConfig.js";

// The aim of the genesis tests is to provide a baseline to test genesis-state initialization and test if the
// proposed genesis-validity conditions are working.

/* eslint-disable @typescript-eslint/naming-convention */

export const genesis: TestRunnerFn<any, any> = (fork, testName, testSuite) => {
  const testFn = genesisTestFns[testName];
  if (testFn === undefined) {
    throw Error(`Unknown genesis test ${testName}`);
  }

  return testFn(fork, testName, testSuite);
};

const genesisInitialization: TestRunnerFn<GenesisInitSpecTest, BeaconStateAllForks> = (fork) => {
  return {
    testFunction: (testcase) => {
      const deposits: phase0.Deposit[] = [];
      for (let i = 0; i < testcase.meta.deposits_count; i++) {
        deposits.push(testcase[`deposits_${i}`] as phase0.Deposit);
      }

      const config = getConfig(fork);
      const immutableData = createEmptyEpochContextImmutableData(config, {
        // TODO: Should the genesisValidatorsRoot be random here?
        genesisValidatorsRoot: Buffer.alloc(32, 0),
      });

      return initializeBeaconStateFromEth1(
        getConfig(fork),
        immutableData,
        ssz.Root.fromJson((testcase.eth1 as GenesisInitCase).eth1_block_hash),
        bnToNum((testcase.eth1 as GenesisInitCase).eth1_timestamp),
        deposits,
        undefined,
        testcase["execution_payload_header"] &&
          ssz.bellatrix.ExecutionPayloadHeader.toViewDU(testcase["execution_payload_header"])
      );
    },
    // eth1.yaml
    // ```
    // {eth1_block_hash: '0x1212121212121212121212121212121212121212121212121212121212121212',
    // eth1_timestamp: 1578009600}
    // ```
    // meta.yaml
    // ```
    // {deposits_count: 64}
    // ```
    options: {
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
    },
  };
};

const genesisValidity: TestRunnerFn<GenesisValidityTestCase, boolean> = (fork) => {
  return {
    testFunction: (testcase) => {
      return isValidGenesisState(getConfig(fork), testcase.genesis);
    },
    options: {
      inputTypes: {
        is_valid: InputType.YAML,
        genesis: InputType.SSZ_SNAPPY,
      },
      sszTypes: {
        genesis: ssz[fork].BeaconState,
      },
      getExpected: (testCase) => testCase.is_valid,
      expectFunc: (testCase, expected, actual) => {
        expect(actual).to.be.equal(expected, "isValidGenesisState is not" + expected);
      },
    },
  };
};

const genesisTestFns: Record<string, TestRunnerFn<any, any>> = {
  initialization: genesisInitialization,
  validity: genesisValidity,
};

function generateDepositSSZTypeMapping(n: number): Record<string, typeof ssz.phase0.Deposit> {
  const depositMappings: Record<string, typeof ssz.phase0.Deposit> = {};
  for (let i = 0; i < n; i++) {
    depositMappings[`deposits_${i}`] = ssz.phase0.Deposit;
  }
  return depositMappings;
}

type GenesisValidityTestCase = {
  is_valid: boolean;
  genesis: BeaconStateAllForks;
};

type GenesisInitSpecTest = {
  [k: string]: phase0.Deposit | unknown | null | undefined;
  eth1_block_hash: Root;
  eth1_timestamp: TimeSeconds;
  meta: {
    deposits_count: number;
  };
  execution_payload_header?: bellatrix.ExecutionPayloadHeader;
  state: BeaconStateAllForks;
};

type GenesisInitCase = {
  eth1_block_hash: string;
  eth1_timestamp: bigint;
};
