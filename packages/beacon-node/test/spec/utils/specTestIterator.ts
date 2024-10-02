import fs from "node:fs";
import path from "node:path";
import {describe, it} from "vitest";
import {ForkName} from "@lodestar/params";
import {describeDirectorySpecTest} from "@lodestar/spec-test-util";
import {RunnerType, TestRunner} from "./types.js";

const ARTIFACT_FILENAMES = new Set([
  // MacOS artifacts
  "._.DS_Store",
  ".DS_Store",
  // File included by spec tests downloader
  "version.txt",
]);

export interface SkipOpts {
  skippedTestSuites?: RegExp[];
  skippedTests?: RegExp[];
  skippedForks?: string[];
  skippedRunners?: string[];
  skippedHandlers?: string[];
}

/**
 * Because we want to execute the spec tests in parallel so one or two runners will be executed
 * in isolation at a time and would not be available how many runners are there in total.
 * This list is curated manually and should be updated when new runners are added.
 * It will make sure if specs introduce new runner, we should cover in our spec tests.
 */
const coveredTestRunners = [
  "light_client",
  "epoch_processing",
  "finality",
  "fork",
  "fork_choice",
  "sync",
  "fork",
  "genesis",
  "merkle",
  "operations",
  "rewards",
  "sanity",
  "random",
  "shuffling",
  "ssz_static",
  "transition",
];

// NOTE: You MUST always provide a detailed reason of why a spec test is skipped plus link
// to an issue marking it as pending to re-enable and an aproximate timeline of when it will
// be fixed.
// NOTE: Comment the minimum set of test necessary to unblock PRs: For example, instead of
// skipping all `bls_to_execution_change` tests, just skip for a fork setting:
// ```
// skippedPrefixes: [
//    // Skipped since this only test that withdrawals are de-activated
//    "eip4844/operations/bls_to_execution_change",
// ],
// ```
export const defaultSkipOpts: SkipOpts = {
  skippedForks: ["eip7594"],
  // TODO: capella
  // BeaconBlockBody proof in lightclient is the new addition in v1.3.0-rc.2-hotfix
  // Skip them for now to enable subsequently
  skippedTestSuites: [
    /^capella\/light_client\/single_merkle_proof\/BeaconBlockBody.*/,
    /^deneb\/light_client\/single_merkle_proof\/BeaconBlockBody.*/,
    /^electra\/light_client\/single_merkle_proof\/BeaconBlockBody.*/,
  ],
  skippedTests: [],
  skippedRunners: ["merkle_proof", "networking"],
};

/**
 * This helper ensures that strictly all tests are run. There's no hardcoded value beyond "config".
 * Any additional unknown fork, testRunner, testHandler, or testSuite will result in an error.
 *
 * File path structure:
 * ```
 * tests/
 *   <config name>/                     [general, mainnet, minimal]
 *     <fork or phase name>/            [phase0, altair, bellatrix]
 *       <test runner name>/            [bls, ssz_static, fork]
 *         <test handler name>/         ...
 *           <test suite name>/
 *             <test case>/<output part>
 * ```
 *
 * Examples
 * ```
 *       / config  / fork   / test runner      / test handler / test suite   / test case
 *
 * tests / general / phase0 / bls              / aggregate    / small        / aggregate_na_signatures/data.yaml
 * tests / general / phase0 / ssz_generic      / basic_vector / valid        / vec_bool_1_max/meta.yaml
 * tests / mainnet / altair / ssz_static       / Validator    / ssz_random   / case_0/roots.yaml
 * tests / mainnet / altair / fork             / fork         / pyspec_tests / altair_fork_random_0/meta.yaml
 * ```
 * Ref: https://github.com/ethereum/consensus-specs/tree/dev/tests/formats#test-structure
 */
export function specTestIterator(
  configDirpath: string,
  testRunners: Record<string, TestRunner>,
  opts: SkipOpts = defaultSkipOpts
): void {
  for (const forkStr of readdirSyncSpec(configDirpath)) {
    if (
      opts?.skippedForks?.includes(forkStr) ||
      (process.env.SPEC_FILTER_FORK && forkStr !== process.env.SPEC_FILTER_FORK)
    ) {
      continue;
    }
    const fork = forkStr as ForkName;

    const forkDirpath = path.join(configDirpath, forkStr);
    for (const testRunnerName of readdirSyncSpec(forkDirpath)) {
      if (opts?.skippedRunners?.includes(testRunnerName)) {
        continue;
      }

      const testRunnerDirpath = path.join(forkDirpath, testRunnerName);
      const testRunner = testRunners[testRunnerName];

      if (testRunner === undefined && coveredTestRunners.includes(testRunnerName)) {
        // That runner is not part of the current call to specTestIterator
        continue;
      }

      if (testRunner === undefined && !coveredTestRunners.includes(testRunnerName)) {
        throw new Error(
          `No test runner for ${testRunnerName}. Please make sure it is covered in "coveredTestRunners" if you added new runner.`
        );
      }

      for (const testHandler of readdirSyncSpec(testRunnerDirpath)) {
        if (opts?.skippedHandlers?.includes(testHandler)) {
          continue;
        }

        const testHandlerDirpath = path.join(testRunnerDirpath, testHandler);
        for (const testSuite of readdirSyncSpec(testHandlerDirpath)) {
          const testId = `${fork}/${testRunnerName}/${testHandler}/${testSuite}`;

          if (opts?.skippedTestSuites?.some((skippedMatch) => testId.match(skippedMatch))) {
            displaySkipTest(testId);
          } else if (fork === undefined) {
            displayFailTest(testId, `Unknown fork ${forkStr}`);
          } else {
            const testSuiteDirpath = path.join(testHandlerDirpath, testSuite);
            // Specific logic for ssz_static since it has one extra level of directories
            if (testRunner.type === RunnerType.custom) {
              describe(testId, () => {
                testRunner.fn(fork, testHandler, testSuite, testSuiteDirpath);
              });
            }

            // Generic testRunner
            else {
              const {testFunction, options} = testRunner.fn(fork, testHandler, testSuite);
              if (opts.skippedTests && options.shouldSkip === undefined) {
                options.shouldSkip = (_testCase: any, name: string, _index: number): boolean => {
                  return opts?.skippedTests?.some((skippedMatch) => name.match(skippedMatch)) ?? false;
                };
              }
              describeDirectorySpecTest(testId, testSuiteDirpath, testFunction, options);
            }
          }
        }
      }
    }
  }
}

function displayFailTest(testId: string, msg: string): void {
  describe(testId, () => {
    it(testId, () => {
      throw Error(msg);
    });
  });
}

function displaySkipTest(testId: string): void {
  describe(testId, () => {
    it.skip(testId, () => {
      //
    });
  });
}

export function readdirSyncSpec(dirpath: string): string[] {
  const files = fs.readdirSync(dirpath);
  return files.filter((file) => !ARTIFACT_FILENAMES.has(file));
}
