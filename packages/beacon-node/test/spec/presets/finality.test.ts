import path from "node:path";
import {expect} from "vitest";
import {getConfig} from "@lodestar/config/test-utils";
import {ACTIVE_PRESET, ForkName} from "@lodestar/params";
import {
  BeaconStateAllForks,
  DataAvailabilityStatus,
  ExecutionPayloadStatus,
  stateTransition,
} from "@lodestar/state-transition";
import {altair, bellatrix, ssz} from "@lodestar/types";
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

const finality: TestRunnerFn<FinalityTestCase, BeaconStateAllForks | undefined> = (fork) => {
  return {
    testFunction: async (testcase, _directoryName, testCaseName) => {
      let state = createCachedBeaconStateTest(testcase.pre, getConfig(fork));
      const {metrics, register} = createSpecTestMetrics();
      const verify = shouldVerify(testcase);
      const runStateTransition = (): void => {
        for (let i = 0; i < testcase.meta.blocks_count; i++) {
          const signedBlock = testcase[`blocks_${i}`] as bellatrix.SignedBeaconBlock;

          state = stateTransition(
            state,
            signedBlock,
            {
              // Should assume payload valid and blob data available for this test
              executionPayloadStatus: ExecutionPayloadStatus.valid,
              dataAvailabilityStatus: DataAvailabilityStatus.Available,
              verifyStateRoot: false,
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
      state.commit();
      await expectNoProgressiveBalancesMismatches(register, testCaseName);
      return state;
    },
    options: {
      inputTypes: inputTypeSszTreeViewDU,
      sszTypes: {
        pre: ssz[fork].BeaconState,
        post: ssz[fork].BeaconState,
        ...generateBlocksSZZTypeMapping(fork, 200),
      },
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

/**
 * `meta.yaml`
 * ```
 * {blocks_count: 16}
 * ```
 * https://github.com/ethereum/consensus-specs/blob/v1.6.1/tests/formats/finality/README.md
 */
type FinalityTestCase = {
  [k: string]: altair.SignedBeaconBlock | unknown | null | undefined;
  meta: {
    blocks_count: number;
    bls_setting: bigint;
  };
  pre: BeaconStateAllForks;
  post?: BeaconStateAllForks;
};

specTestIterator(path.join(ethereumConsensusSpecsTests.outputDir, "tests", ACTIVE_PRESET), {
  finality: {type: RunnerType.default, fn: finality},
});
