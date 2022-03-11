import {join} from "node:path";
import {TreeBacked} from "@chainsafe/ssz";
import {
  CachedBeaconStateAllForks,
  allForks,
  altair,
  createCachedBeaconState,
} from "@chainsafe/lodestar-beacon-state-transition";
import {describeDirectorySpecTest} from "@chainsafe/lodestar-spec-test-util";
import {bellatrix, ssz} from "@chainsafe/lodestar-types";
import {ACTIVE_PRESET, ForkName} from "@chainsafe/lodestar-params";
import {SPEC_TEST_LOCATION} from "../specTestVersioning";
import {IBaseSpecTest, shouldVerify} from "../type";
import {expectEqualBeaconState, inputTypeSszTreeBacked} from "../util";
import {getConfig} from "./util";
import {generateBlocksSZZTypeMapping} from "./sanity";

/* eslint-disable @typescript-eslint/naming-convention */

export function finality(fork: ForkName): void {
  describeDirectorySpecTest<IFinalityTestCase, allForks.BeaconState>(
    `${ACTIVE_PRESET}/${fork}/finality/finality`,
    join(SPEC_TEST_LOCATION, `/tests/${ACTIVE_PRESET}/${fork}/finality/finality/pyspec_tests`),
    (testcase) => {
      let wrappedState = createCachedBeaconState(
        getConfig(fork),
        testcase.pre as TreeBacked<allForks.BeaconState>
      ) as CachedBeaconStateAllForks;
      const verify = shouldVerify(testcase);
      for (let i = 0; i < testcase.meta.blocks_count; i++) {
        const signedBlock = testcase[`blocks_${i}`] as bellatrix.SignedBeaconBlock;

        wrappedState = allForks.stateTransition(
          wrappedState,
          ssz[fork].SignedBeaconBlock.createTreeBackedFromStruct(signedBlock),
          {
            verifyStateRoot: false,
            verifyProposer: verify,
            verifySignatures: verify,
          }
        );
      }
      return wrappedState;
    },
    {
      inputTypes: inputTypeSszTreeBacked,
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
    }
  );
}

/**
 * `meta.yaml`
 * ```
 * {blocks_count: 16}
 * ```
 * https://github.com/ethereum/consensus-specs/blob/dev/tests/formats/finality/README.md
 */
interface IFinalityTestCase extends IBaseSpecTest {
  [k: string]: altair.SignedBeaconBlock | unknown | null | undefined;
  meta: {
    blocks_count: number;
    bls_setting: bigint;
  };
  pre: altair.BeaconState;
  post?: altair.BeaconState;
}
