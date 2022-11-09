import fs from "node:fs";
import path from "node:path";
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
export function specTestIterator(configDirpath: string, testRunners: Record<string, TestRunner>): void {
  for (const forkStr of readdirSyncSpec(configDirpath)) {
    const fork = ForkName[forkStr as ForkName];
    if (fork === undefined) {
      throw Error(`Unknown fork ${forkStr}`);
    }

    const forkDirpath = path.join(configDirpath, fork);
    for (const testRunnerName of readdirSyncSpec(forkDirpath)) {
      // We don't have runner for light client yet
      if (["light_client", "sync"].includes(testRunnerName)) {
        continue;
      }
      const testRunnerDirpath = path.join(forkDirpath, testRunnerName);

      const testRunner = testRunners[testRunnerName];
      if (testRunner === undefined) {
        throw Error(`No test runner for ${testRunnerName}`);
      }

      for (const testHandler of readdirSyncSpec(testRunnerDirpath)) {
        const testHandlerDirpath = path.join(testRunnerDirpath, testHandler);
        for (const testSuite of readdirSyncSpec(testHandlerDirpath)) {
          const testId = `${fork}/${testRunnerName}/${testHandler}/${testSuite}`;
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

            describeDirectorySpecTest(testId, testSuiteDirpath, testFunction, options);
          }
        }
      }
    }
  }
}

export function readdirSyncSpec(dirpath: string): string[] {
  const files = fs.readdirSync(dirpath);
  return files.filter((file) => !ARTIFACT_FILENAMES.has(file));
}
