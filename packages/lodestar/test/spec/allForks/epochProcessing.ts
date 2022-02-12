import {join} from "node:path";
import fs from "node:fs";

import {
  CachedBeaconStateAllForks,
  allForks,
  EpochProcess,
  createCachedBeaconState,
  beforeProcessEpoch,
} from "@chainsafe/lodestar-beacon-state-transition";
import {describeDirectorySpecTest} from "@chainsafe/lodestar-spec-test-util";
import {ssz} from "@chainsafe/lodestar-types";
import {TreeBacked} from "@chainsafe/ssz";
import {ACTIVE_PRESET, ForkName} from "@chainsafe/lodestar-params";
import {SPEC_TEST_LOCATION} from "../specTestVersioning";
import {expectEqualBeaconState, inputTypeSszTreeBacked} from "../util";
import {getConfig} from "./util";
import {IBaseSpecTest} from "../type";

export type EpochProcessFn = (state: CachedBeaconStateAllForks, epochProcess: EpochProcess) => void;

/**
 * https://github.com/ethereum/consensus-specs/blob/dev/tests/formats/epoch_processing/README.md
 */
type EpochProcessingStateTestCase = IBaseSpecTest & {
  pre: allForks.BeaconState;
  post: allForks.BeaconState;
};

/**
 * @param fork
 * @param epochProcessFns Describe with which function to run each directory of tests
 */
export function epochProcessing(fork: ForkName, epochProcessFns: Record<string, EpochProcessFn>): void {
  const rootDir = join(SPEC_TEST_LOCATION, `tests/${ACTIVE_PRESET}/${fork}/epoch_processing`);
  for (const testDir of fs.readdirSync(rootDir)) {
    const epochProcessFn = epochProcessFns[testDir];
    if (epochProcessFn === undefined) {
      throw Error(`No epochProcessFn for ${testDir}`);
    }

    describeDirectorySpecTest<EpochProcessingStateTestCase, allForks.BeaconState>(
      `${ACTIVE_PRESET}/${fork}/epoch_processing/${testDir}`,
      join(rootDir, `${testDir}/pyspec_tests`),
      (testcase) => {
        const stateTB = (testcase.pre as TreeBacked<allForks.BeaconState>).clone();
        const state = createCachedBeaconState(getConfig(fork), stateTB);
        const epochProcess = beforeProcessEpoch(state);
        epochProcessFn(state, epochProcess);
        return state;
      },
      {
        inputTypes: inputTypeSszTreeBacked,
        sszTypes: {
          pre: ssz[fork].BeaconState,
          post: ssz[fork].BeaconState,
        },
        getExpected: (testCase) => testCase.post,
        expectFunc: (testCase, expected, actual) => {
          expectEqualBeaconState(fork, expected, actual);
        },
      }
    );
  }
}
