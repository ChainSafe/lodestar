import path from "node:path";
import {fileURLToPath} from "node:url";
import specTestVersions from "../spec-tests-version.json" with {type: "json"};

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * `SPEC_TESTS_DIR` points the spec test runners at another root holding `tests/<preset>/<fork>/<runner>/...`,
 * for example a locally generated compliance suite, without re-downloading the pinned release.
 */
export const ethereumConsensusSpecsTests = {
  ...specTestVersions.ethereumConsensusSpecsTests,
  outputDir:
    process.env.SPEC_TESTS_DIR ??
    path.join(__dirname, "../../", specTestVersions.ethereumConsensusSpecsTests.outputDirBase),
};

export const sszSpecTests = {
  ...specTestVersions.sszSpecTests,
  outputDir: path.join(__dirname, "../../", specTestVersions.sszSpecTests.outputDirBase),
};

export const blsSpecTests = {
  ...specTestVersions.blsSpecTests,
  outputDir: path.join(__dirname, "../../", specTestVersions.blsSpecTests.outputDirBase),
};

// Even though comptests is run indepdently from spec test, it still shares the same
// version and repo url with spec test
export const comptestsSpecTests = {
  ...specTestVersions.comptestsSpecTests,
  specVersion: specTestVersions.ethereumConsensusSpecsTests.specVersion,
  specTestsRepoUrl: specTestVersions.ethereumConsensusSpecsTests.specTestsRepoUrl,
  outputDir: path.join(__dirname, "../../", specTestVersions.comptestsSpecTests.outputDirBase),
};
