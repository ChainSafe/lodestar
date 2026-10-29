import path from "node:path";
import {expect} from "vitest";
import {getConfig} from "@lodestar/config/test-utils";
import {ACTIVE_PRESET, ForkName} from "@lodestar/params";
import {BeaconStateAllForks, DataAvailabilityStatus, ExecutionPayloadStatus} from "@lodestar/state-transition";
import {SignedBeaconBlock, altair, ssz} from "@lodestar/types";
import {ethereumConsensusSpecsTests} from "../specTestVersioning.js";
import {expectEqualBeaconState, inputTypeSszTreeViewDU} from "../utils/expectEqualBeaconState.js";
import {
  createSpecTestMetrics,
  expectInvalidStateTransitionWithNoProgressiveBalancesMismatches,
  expectNoProgressiveBalancesMismatches,
} from "../utils/progressiveBalances.js";
import {specTestIterator} from "../utils/specTestIterator.js";
import {
  createBeaconStateViewForTest,
  replaceStateViewForTest,
  stateViewToBeaconState,
} from "../utils/stateTransition.js";
import {RunnerType, TestRunnerFn, shouldVerify} from "../utils/types.js";

const finality: TestRunnerFn<FinalityTestCase, BeaconStateAllForks | undefined> = (fork) => {
  return {
    testFunction: async (testcase, _directoryName, testCaseName) => {
      const config = getConfig(fork);
      let state = createBeaconStateViewForTest(fork, testcase.pre, config);
      const {metrics, register} = createSpecTestMetrics();
      const verify = shouldVerify(testcase);
      const runStateTransition = (): void => {
        for (let i = 0; i < testcase.meta.blocks_count; i++) {
          const signedBlock = testcase[`blocks_${i}`] as SignedBeaconBlock;

          state = replaceStateViewForTest(state, (preState) =>
            preState.stateTransition(
              {block: signedBlock},
              {
                // Should assume payload valid and blob data available for this test
                executionPayloadStatus: ExecutionPayloadStatus.valid,
                dataAvailabilityStatus: DataAvailabilityStatus.Available,
                verifyStateRoot: false,
                verifyProposer: verify,
                verifySignatures: verify,
              },
              {metrics}
            )
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
      return stateViewToBeaconState(fork, state);
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
      // Do not manually skip tests here, do it in packages/beacon-node/test/spec/utils/specTestIterator.ts
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
