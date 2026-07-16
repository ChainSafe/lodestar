import path from "node:path";
import {fileURLToPath} from "node:url";
import specTestVersions from "../spec-tests-version.json" with {type: "json"};

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ethereumConsensusSpecsTests = {
  ...specTestVersions.ethereumConsensusSpecsTests,
  outputDir: path.join(__dirname, "../../", specTestVersions.ethereumConsensusSpecsTests.outputDirBase),
};

export const blsSpecTests = {
  ...specTestVersions.blsSpecTests,
  outputDir: path.join(__dirname, "../../", specTestVersions.blsSpecTests.outputDirBase),
};

/**
 * Fork-choice compliance vectors (`pnpm download-comptests` / `pnpm test:comptest`).
 * Standalone flow parallel to the standard spec tests: same version pin and repo, but its own
 * output directory so the two downloads are fully order-independent (the generic downloader
 * wipes its whole output directory on a version change).
 * The `comptests.tar.gz` release asset exists for every release since v1.7.0-alpha.11
 * (consensus-specs #5334).
 */
export const comptestsSpecTests = {
  specVersion: specTestVersions.ethereumConsensusSpecsTests.specVersion,
  specTestsRepoUrl: specTestVersions.ethereumConsensusSpecsTests.specTestsRepoUrl,
  testsToDownload: ["comptests"],
  outputDir: path.join(__dirname, "../../", "spec-tests-comptests"),
};
