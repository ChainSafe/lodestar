import path from "node:path";
import {expect} from "vitest";
import {getConfig} from "@lodestar/config/test-utils";
import {ACTIVE_PRESET, ForkName} from "@lodestar/params";
import {InputType} from "@lodestar/spec-test-util";
import {
  BeaconStateAllForks,
  DataAvailabilityStatus,
  ExecutionPayloadStatus,
  processSlots,
  stateTransition,
} from "@lodestar/state-transition";
import {SignedBeaconBlock, deneb, ssz} from "@lodestar/types";
import {bnToNum} from "@lodestar/utils";
import {createCachedBeaconStateTest} from "../../utils/cachedBeaconState.js";
import {ethereumConsensusSpecsTests} from "../specTestVersioning.js";
import {expectEqualBeaconState, inputTypeSszTreeViewDU} from "../utils/expectEqualBeaconState.js";
import {
  createSpecTestMetrics,
  expectInvalidStateTransitionWithNoProgressiveBalancesMismatches,
  expectNoProgressiveBalancesMismatches,
} from "../utils/progressiveBalances.js";
import {specTestIterator} from "../utils/specTestIterator.js";
import {RunnerType, TestRunnerFn, shouldVerify} from "../utils/types.js";

const sanity: TestRunnerFn<any, BeaconStateAllForks | undefined> = (fork, testName, testSuite) => {
  switch (testName) {
    case "slots":
      return sanitySlots(fork, testName, testSuite);
    case "blocks":
      return sanityBlocks(fork, testName, testSuite);
    default:
      throw Error(`Unknown sanity test ${testName}`);
  }
};

const sanitySlots: TestRunnerFn<SanitySlotsTestCase, BeaconStateAllForks | undefined> = (fork) => {
  return {
    testFunction: async (testcase, _directoryName, testCaseName) => {
      const stateTB = testcase.pre.clone();
      const state = createCachedBeaconStateTest(stateTB, getConfig(fork));
      const {metrics, register} = createSpecTestMetrics();
      const runProcessSlots = (): BeaconStateAllForks =>
        processSlots(state, state.slot + bnToNum(testcase.slots), undefined, {metrics});

      if (testcase.post === undefined) {
        await expectInvalidStateTransitionWithNoProgressiveBalancesMismatches(runProcessSlots, register, testCaseName);
        return undefined;
      }

      const postState = runProcessSlots();
      // TODO: May be part of runStateTranstion, necessary to commit again?
      postState.commit();
      await expectNoProgressiveBalancesMismatches(register, testCaseName);
      return postState;
    },
    options: {
      inputTypes: {...inputTypeSszTreeViewDU, slots: InputType.YAML},
      sszTypes: {
        pre: ssz[fork].BeaconState,
        post: ssz[fork].BeaconState,
      },
      timeout: 30000,
      getExpected: (testCase) => testCase.post,
      expectFunc: (_testCase, expected, actual) => {
        if (expected === undefined) {
          expect(actual).toBeUndefined();
          return;
        }
        expectEqualBeaconState(fork, expected, actual);
      },
      // Do not manually skip tests here, do it in packages/beacon-node/test/spec/presets/index.test.ts
    },
  };
};

const sanityBlocks: TestRunnerFn<SanityBlocksTestCase, BeaconStateAllForks | undefined> = (fork) => {
  return {
    testFunction: async (testcase, _directoryName, testCaseName) => {
      const stateTB = testcase.pre;
      let wrappedState = createCachedBeaconStateTest(stateTB, getConfig(fork));
      const {metrics, register} = createSpecTestMetrics();
      const verify = shouldVerify(testcase);
      const runStateTransition = (): void => {
        for (let i = 0; i < testcase.meta.blocks_count; i++) {
          const signedBlock = testcase[`blocks_${i}`] as deneb.SignedBeaconBlock;
          wrappedState = stateTransition(
            wrappedState,
            signedBlock,
            {
              // Assume valid and available for this test
              executionPayloadStatus: ExecutionPayloadStatus.valid,
              dataAvailabilityStatus: DataAvailabilityStatus.Available,
              // Always verify the state root, it is not gated by bls_setting
              verifyStateRoot: true,
              verifyProposer: verify,
              verifySignatures: verify,
            },
            {metrics}
          );
        }
      };

      if (testcase.post === undefined) {
        await expectInvalidStateTransitionWithNoProgressiveBalancesMismatches(
          runStateTransition,
          register,
          testCaseName
        );
        return undefined;
      }

      runStateTransition();
      await expectNoProgressiveBalancesMismatches(register, testCaseName);
      return wrappedState;
    },
    options: {
      inputTypes: inputTypeSszTreeViewDU,
      sszTypes: {
        pre: ssz[fork].BeaconState,
        post: ssz[fork].BeaconState,
        ...generateBlocksSZZTypeMapping(fork, 99),
      },
      // Only an ssz list limit violation is an expected input error, anything else is a decode bug
      shouldErrorOnInput: (error: Error, inputNames: Set<string>) =>
        !inputNames.has("post") && /over limit/.test(error.message),
      timeout: 10000,
      getExpected: (testCase) => testCase.post,
      expectFunc: (_testCase, expected, actual) => {
        if (expected === undefined) {
          expect(actual).toBeUndefined();
          return;
        }
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
  post?: BeaconStateAllForks;
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
