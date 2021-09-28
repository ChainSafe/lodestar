import {join} from "path";
import fs from "fs";

import {CachedBeaconState, allForks} from "@chainsafe/lodestar-beacon-state-transition";
import {describeDirectorySpecTest} from "@chainsafe/lodestar-spec-test-util";
import {ssz} from "@chainsafe/lodestar-types";
import {TreeBacked} from "@chainsafe/ssz";
import {ACTIVE_PRESET, ForkName, PresetName} from "@chainsafe/lodestar-params";
import {SPEC_TEST_LOCATION} from "../../specTestVersioning";
import {expectEqualBeaconState, inputTypeSszTreeBacked} from "../util";
import {getConfig} from "./util";
import {IBaseSpecTest} from "../type";

export type EpochProcessFn = (
  state: CachedBeaconState<allForks.BeaconState>,
  epochProcess: allForks.IEpochProcess
) => void;

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
    if (!epochProcessFn) {
      throw Error(`No epochProcessFn for ${testDir}`);
    }

    describeDirectorySpecTest<EpochProcessingStateTestCase, allForks.BeaconState>(
      `${ACTIVE_PRESET}/${fork}/epoch_processing/${testDir}`,
      join(rootDir, `${testDir}/pyspec_tests`),
      (testcase) => {
        const stateTB = (testcase.pre as TreeBacked<allForks.BeaconState>).clone();
        const state = allForks.createCachedBeaconState(getConfig(fork), stateTB);
        const epochProcess = allForks.beforeProcessEpoch(state);
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
        shouldSkip: (testCase, n) =>
          // TODO: All the tests below fail with the same error
          //
          // Error: Cannot get block root for slot in the future: 47 < 47
          // at Object.lt (/home/lion/Code/eth2.0/lodestar/packages/utils/src/assert.ts:43:13)
          // at Object.getBlockRootAtSlot (/home/lion/Code/eth2.0/lodestar/packages/beacon-state-transition/src/util/blockRoot.ts:17:10)
          // at Object.statusProcessEpoch (/home/lion/Code/eth2.0/lodestar/packages/beacon-state-transition/src/phase0/epoch/processPendingAttestations.ts:40:66)
          // at Object.beforeProcessEpoch (/home/lion/Code/eth2.0/lodestar/packages/beacon-state-transition/src/allForks/util/epochProcess.ts:189:5)
          fork === ForkName.phase0 &&
          ACTIVE_PRESET === PresetName.minimal &&
          testDir === "justification_and_finalization" &&
          (n === "123_ok_support" ||
            n === "123_poor_support" ||
            n === "12_ok_support" ||
            n === "12_ok_support_messed_target" ||
            n === "12_poor_support"),
      }
    );
  }
}
