import path from "node:path";
import {InputType} from "@lodestar/spec-test-util";
import {
  BeaconStateAllForks,
  DataAvailableStatus,
  ExecutionPayloadStatus,
  processSlots,
  stateTransition,
} from "@lodestar/state-transition";
import {SignedBeaconBlock, deneb, ssz} from "@lodestar/types";
import {ACTIVE_PRESET, ForkName} from "@lodestar/params";
import {bnToNum} from "@lodestar/utils";
import {createCachedBeaconStateTest} from "../../utils/cachedBeaconState.js";
import {expectEqualBeaconState, inputTypeSszTreeViewDU} from "../utils/expectEqualBeaconState.js";
import {RunnerType, shouldVerify, TestRunnerFn} from "../utils/types.js";
import {getConfig} from "../../utils/config.js";
import {assertCorrectProgressiveBalances} from "../config.js";
import {ethereumConsensusSpecsTests} from "../specTestVersioning.js";
import {specTestIterator} from "../utils/specTestIterator.js";

const sanity: TestRunnerFn<any, BeaconStateAllForks> = (fork, testName, testSuite) => {
  switch (testName) {
    case "slots":
      return sanitySlots(fork, testName, testSuite);
    case "blocks":
      return sanityBlocks(fork, testName, testSuite);
    default:
      throw Error(`Unknown sanity test ${testName}`);
  }
};

const sanitySlots: TestRunnerFn<SanitySlotsTestCase, BeaconStateAllForks> = (fork) => {
  return {
    testFunction: (testcase) => {
      const stateTB = testcase.pre.clone();
      const state = createCachedBeaconStateTest(stateTB, getConfig(fork));
      const postState = processSlots(state, state.slot + bnToNum(testcase.slots), {assertCorrectProgressiveBalances});
      // TODO: May be part of runStateTranstion, necessary to commit again?
      postState.commit();
      return postState;
    },
    options: {
      inputTypes: {...inputTypeSszTreeViewDU, slots: InputType.YAML},
      sszTypes: {
        pre: ssz[fork].BeaconState,
        post: ssz[fork].BeaconState,
      },
      shouldError: (testCase) => !testCase.post,
      timeout: 10000,
      getExpected: (testCase) => testCase.post,
      expectFunc: (_testCase, expected, actual) => {
        expectEqualBeaconState(fork, expected, actual);
      },
      // Do not manually skip tests here, do it in packages/beacon-node/test/spec/presets/index.test.ts
    },
  };
};

const sanityBlocks: TestRunnerFn<SanityBlocksTestCase, BeaconStateAllForks> = (fork) => {
  return {
    testFunction: (testcase) => {
      const stateTB = testcase.pre;
      let wrappedState = createCachedBeaconStateTest(stateTB, getConfig(fork));
      const verify = shouldVerify(testcase);
      for (let i = 0; i < testcase.meta.blocks_count; i++) {
        const signedBlock = testcase[`blocks_${i}`] as deneb.SignedBeaconBlock;
        wrappedState = stateTransition(wrappedState, signedBlock, {
          // Assume valid and available for this test
          executionPayloadStatus: ExecutionPayloadStatus.valid,
          dataAvailableStatus: DataAvailableStatus.available,
          verifyStateRoot: verify,
          verifyProposer: verify,
          verifySignatures: verify,
          assertCorrectProgressiveBalances,
        });
      }
      return wrappedState;
    },
    options: {
      inputTypes: inputTypeSszTreeViewDU,
      sszTypes: {
        pre: ssz[fork].BeaconState,
        post: ssz[fork].BeaconState,
        ...generateBlocksSZZTypeMapping(fork, 99),
      },
      shouldError: (testCase) => testCase.post === undefined,
      timeout: 10000,
      getExpected: (testCase) => testCase.post,
      expectFunc: (_testCase, expected, actual) => {
        expectEqualBeaconState(fork, expected, actual);
      },
      // Do not manually skip tests here, do it in packages/beacon-node/test/spec/presets/index.test.ts
    },
  };
};

type BlocksSZZTypeMapping = Record<string, (typeof ssz)[ForkName]["SignedBeaconBlock"]>;

export function generateBlocksSZZTypeMapping(fork: ForkName, n: number): BlocksSZZTypeMapping {
  const blocksMapping: BlocksSZZTypeMapping = {};
  for (let i = 0; i < n; i++) {
    blocksMapping[`blocks_${i}`] = ssz[fork].SignedBeaconBlock;
  }
  return blocksMapping;
}

type SanityBlocksTestCase = {
  [k: string]: SignedBeaconBlock | unknown | null | undefined;
  meta: {
    blocks_count: number;
    bls_setting: bigint;
  };
  pre: BeaconStateAllForks;
  post: BeaconStateAllForks;
};

type SanitySlotsTestCase = {
  meta?: any;
  pre: BeaconStateAllForks;
  post?: BeaconStateAllForks;
  slots: bigint;
};

specTestIterator(path.join(ethereumConsensusSpecsTests.outputDir, "tests", ACTIVE_PRESET), {
  sanity: {type: RunnerType.default, fn: sanity},
  random: {type: RunnerType.default, fn: sanityBlocks},
});
