import {ForkName} from "@chainsafe/lodestar-params";
import fs from "node:fs";
import path from "node:path";
import {SPEC_TEST_LOCATION} from "../specTestVersioning";
import {describeDirectorySpecTest} from "@chainsafe/lodestar-spec-test-util";
import {RunnerType, TestRunner} from "./types";
import {expect} from "chai";

const specTestsTestPath = path.join(SPEC_TEST_LOCATION, "tests");
const ARTIFACT_FILENAMES = new Set(["._.DS_Store", ".DS_Store"]);

// This test ensures that we are covering all available spec tests.
// The directory structure is organized first by preset, then by fork.
// The presets mainnet and minimal have the same directory structure.
//
// File path structure:
// tests/
//   <config name>/
//     <fork or phase name>/
//       <test runner name>/
//         <test handler name>/
//           <test suite name>/
//             <test case>/<output part>
//
// spec-tests/
// ├── tests
// │   ├── general
// │   │   ├── altair
// │   │   └── phase0
// │   ├── mainnet
// │   │   ├── altair
// │   │   ├── bellatrix
// │   │   └── phase0
// │   └── minimal
// │       ├── altair
// │       ├── bellatrix
// │       └── phase0
//
// Examples
//
//       / config  / fork   / test runner      / test handler / test suite   / test case
//
// tests / general / phase0 / bls              / aggregate    / small        / aggregate_0x0000000000000000000000000000000000000000000000000000000000000000/data.yaml
// tests / general / phase0 / ssz_generic      / basic_vector / valid        / vec_bool_1_max/meta.yaml
// tests / mainnet / altair / ssz_static       / Validator    / ssz_random   / case_0/roots.yaml
// tests / mainnet / altair / fork             / fork         / pyspec_tests / altair_fork_random_0/meta.yaml
//
// Lodestar spec test organization mixes mainnet and minimal preset in the same file.
// Tests are then organized by fork and follow the same naming structure as the spec tests.

export function specTestIterator(configName: string, testRunners: Record<string, TestRunner>): void {
  // Check no unknown directory at the top level
  expect(readdirSyncSpec(specTestsTestPath).sort()).to.deep.equal(
    ["general", "mainnet", "minimal"],
    "Unknown top level directories"
  );

  const configDirpath = path.join(specTestsTestPath, configName);
  for (const forkStr of readdirSyncSpec(configDirpath)) {
    const fork = ForkName[forkStr as ForkName];
    if (fork === undefined) {
      throw Error(`Unknown fork ${forkStr}`);
    }

    const forkDirpath = path.join(configDirpath, fork);
    for (const testRunnerName of readdirSyncSpec(forkDirpath)) {
      const testRunnerDirpath = path.join(forkDirpath, testRunnerName);

      const testRunner = testRunners[testRunnerName];
      if (testRunner === undefined) {
        throw Error(`No test runner for ${testRunnerName}`);
      }

      for (const testHandler of readdirSyncSpec(testRunnerDirpath)) {
        const testHandlerDirpath = path.join(testRunnerDirpath, testHandler);
        for (const testSuite of readdirSyncSpec(testHandlerDirpath)) {
          const testId = `${configName}/${fork}/${testRunnerName}/${testHandler}/${testSuite}`;
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

function readdirSyncSpec(dirpath: string): string[] {
  const files = fs.readdirSync(dirpath);
  return files.filter((file) => !ARTIFACT_FILENAMES.has(file));
}
