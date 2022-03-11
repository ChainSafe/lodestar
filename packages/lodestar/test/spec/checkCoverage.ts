import {expect} from "chai";
import fs from "node:fs";
import path from "node:path";
import {SPEC_TEST_LOCATION} from "./specTestVersioning";

// TEMP TEMP
const forksToIgnore = new Set<string>([]);

// This test ensures that we are covering all available spec tests.
// The directory structure is organized first by preset, then by fork.
// The presets mainnet and minimal have the same directory structure.
//
// spec-tests/
// ├── tests
// │   ├── general
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
// Each fork has the same structure but adding extra tests for added functionality
//
// | phase0           | altair           | bellatrix            |
// | ---------------- | ---------------- | ---------------- |
// | epoch_processing | epoch_processing | epoch_processing |
// | finality         | finality         | finality
// | -                | fork             | -
// | fork_choice      | fork_choice      | fork_choice
// | genesis          | genesis          | -
// | operations       | operations       | operations
// | rewards          | rewards          | rewards
// | sanity           | sanity           | sanity
// | shuffling        | -                | -
// | ssz_static       | ssz_static       | ssz_static
// | -                | transition       | -
//
// ------------
//
// Lodestar spec test organization mixes mainnet and minimal preset in the same file.
// Tests are then organized by fork and follow the same naming structure as the spec tests.

const knownPresets = ["mainnet", "minimal"];
const knownForks = ["altair", "bellatrix", "phase0"];
const lodestarTests = path.join(__dirname, "../spec");

const missingTests = new Set<string>();

const specTestsTestPath = path.join(SPEC_TEST_LOCATION, "tests");
const specTestsTestLs = fs.readdirSync(specTestsTestPath);
expect(specTestsTestLs).to.deep.equal(["general", ...knownPresets], "New dir in spec-tests/tests");

for (const preset of knownPresets) {
  const presetDirPath = path.join(specTestsTestPath, preset);
  const presetDirLs = fs
    .readdirSync(presetDirPath, {withFileTypes: true})
    // Ignore the .DS_Store and ._.DS_Store artificat files by filtering directories
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name);
  expect(presetDirLs).to.deep.equal(knownForks, `New fork in spec-tests/tests/${preset}`);

  for (const fork of knownForks) {
    if (forksToIgnore.has(fork)) continue;
    ensureDirTestCoverage(presetDirPath, fork);
  }
}

if (missingTests.size > 0) {
  throw Error(`Some spec tests are not covered: \n${Array.from(missingTests.values()).join("\n")}`);
}

/**
 * Ensure there are Lodestar spec tests for all EF spec tests
 * @param rootTestDir EF spec test root dir: /spec-tests/tests/minimal/
 * @param testRelDir /altair/
 */
function ensureDirTestCoverage(rootTestDir: string, testRelDir: string): void {
  // spec-tests/tests/mainnet/phase0/
  // ├── epoch_processing
  // ├── finality
  // ├── fork_choice
  // ├── genesis
  // ├── operations
  // ├── rewards
  // ├── sanity
  // ├── shuffling
  // └── ssz_static
  const testGroups = fs
    .readdirSync(path.join(rootTestDir, testRelDir), {withFileTypes: true})
    // Ignore the .DS_Store and ._.DS_Store artificat files by filtering directories
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name);
  for (const testGroup of testGroups) {
    const testDir = path.join(lodestarTests, testRelDir, testGroup);
    const testFile = testDir + ".test.ts";
    if (existsDir(testDir)) {
      // Check next dir level
      ensureDirTestCoverage(rootTestDir, path.join(testRelDir, testGroup));
    } else if (existsFile(testFile)) {
      // Is file, assume it covers all cases
    } else {
      missingTests.add(path.relative(lodestarTests, testDir));
    }
  }
}

function existsDir(p: string): boolean {
  try {
    return fs.lstatSync(p).isDirectory();
  } catch (e) {
    if ((e as {code: string}).code === "ENOENT") return false;
    throw e;
  }
}

function existsFile(p: string): boolean {
  try {
    return fs.lstatSync(p).isFile();
  } catch (e) {
    if ((e as {code: string}).code === "ENOENT") return false;
    throw e;
  }
}
