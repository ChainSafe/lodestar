import {
  BeaconStateAllForks,
  DataAvailableStatus,
  ExecutionPayloadStatus,
  stateTransition,
} from "@lodestar/state-transition";
import {altair, bellatrix, ssz} from "@lodestar/types";
import {ForkName} from "@lodestar/params";
import {createCachedBeaconStateTest} from "../../utils/cachedBeaconState.js";
import {expectEqualBeaconState, inputTypeSszTreeViewDU} from "../utils/expectEqualBeaconState.js";
import {shouldVerify, TestRunnerFn} from "../utils/types.js";
import {getConfig} from "../../utils/config.js";
import {assertCorrectProgressiveBalances} from "../config.js";

/* eslint-disable @typescript-eslint/naming-convention */

export const finality: TestRunnerFn<FinalityTestCase, BeaconStateAllForks> = (fork) => {
  return {
    testFunction: (testcase) => {
      let state = createCachedBeaconStateTest(testcase.pre, getConfig(fork));
      const verify = shouldVerify(testcase);
      for (let i = 0; i < testcase.meta.blocks_count; i++) {
        const signedBlock = testcase[`blocks_${i}`] as bellatrix.SignedBeaconBlock;

        state = stateTransition(state, signedBlock, {
          // TODO DENEB: Should assume valid and available for this test?
          executionPayloadStatus: ExecutionPayloadStatus.valid,
          dataAvailableStatus: DataAvailableStatus.available,
          verifyStateRoot: false,
          verifyProposer: verify,
          verifySignatures: verify,
          assertCorrectProgressiveBalances,
        });
      }

      state.commit();
      return state;
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
      expectFunc: (testCase, expected, actual) => {
        expectEqualBeaconState(fork, expected, actual);
      },
      // Do not manually skip tests here, do it in packages/beacon-node/test/spec/presets/index.test.ts
    },
  };
};

type BlocksSZZTypeMapping = Record<string, typeof ssz[ForkName]["SignedBeaconBlock"]>;

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
 * https://github.com/ethereum/consensus-specs/blob/dev/tests/formats/finality/README.md
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
