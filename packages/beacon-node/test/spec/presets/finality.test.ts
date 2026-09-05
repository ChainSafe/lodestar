import path from "node:path";
import {getConfig} from "@lodestar/config/test-utils";
import {ACTIVE_PRESET, ForkName, isForkPostGloas} from "@lodestar/params";
import {BeaconStateAllForks, DataAvailabilityStatus, ExecutionPayloadStatus} from "@lodestar/state-transition";
import {SignedBeaconBlock, altair, ssz} from "@lodestar/types";
import {assertCorrectProgressiveBalances} from "../config.js";
import {ethereumConsensusSpecsTests} from "../specTestVersioning.js";
import {expectEqualBeaconState, inputTypeSszTreeViewDU} from "../utils/expectEqualBeaconState.js";
import {specTestIterator} from "../utils/specTestIterator.js";
import {
  createBeaconStateViewForTest,
  stateViewToBeaconState,
  useNativeStateTransition,
} from "../utils/stateTransition.js";
import {RunnerType, TestRunnerFn, shouldVerify} from "../utils/types.js";

const finality: TestRunnerFn<FinalityTestCase, BeaconStateAllForks> = (fork) => {
  return {
    testFunction: (testcase) => {
      const config = getConfig(fork);
      let state = createBeaconStateViewForTest(fork, testcase.pre, config);
      const verify = shouldVerify(testcase);
      for (let i = 0; i < testcase.meta.blocks_count; i++) {
        const signedBlock = testcase[`blocks_${i}`] as SignedBeaconBlock;

        state = state.stateTransition(
          {block: signedBlock},
          {
            // Should assume payload valid and blob data available for this test
            executionPayloadStatus: ExecutionPayloadStatus.valid,
            dataAvailabilityStatus: DataAvailabilityStatus.Available,
            verifyStateRoot: false,
            verifyProposer: verify,
            verifySignatures: verify,
            assertCorrectProgressiveBalances,
          },
          {}
        );
      }

      return stateViewToBeaconState(fork, state);
    },
    options: {
      inputTypes: inputTypeSszTreeViewDU,
      sszTypes: {
        pre: ssz[fork].BeaconState,
        post: ssz[fork].BeaconState,
        ...generateBlocksSZZTypeMapping(fork, 200),
      },
      shouldError: (testCase) => !testCase.post,
      timeout: 10000,
      getExpected: (testCase) => testCase.post,
      expectFunc: (_testCase, expected, actual) => {
        expectEqualBeaconState(fork, expected, actual);
      },
      // Do not manually skip tests here, do it in packages/beacon-node/test/spec/presets/index.test.ts
      shouldSkip: () => useNativeStateTransition && isForkPostGloas(fork),
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
