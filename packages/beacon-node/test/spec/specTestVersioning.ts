import path from "node:path";
import {fileURLToPath} from "node:url";
import {DownloadTestsOptions} from "@lodestar/spec-test-util";

// WARNING! Don't move or rename this file !!!
//
// This file is used to generate the cache ID for spec tests download in Github Actions CI
// It's path is hardcoded in: `.github/workflows/test-spec.yml`
//
// The contents of this file MUST include the URL, version and target path, and nothing else.

// Global variable __dirname no longer available in ES6 modules.
// Solutions: https://stackoverflow.com/questions/46745014/alternative-for-dirname-in-node-js-when-using-es6-modules
// eslint-disable-next-line @typescript-eslint/naming-convention
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ethereumConsensusSpecsTests: DownloadTestsOptions = {
  specVersion: "v1.4.0-beta.2-hotfix",
  // Target directory is the host package root: 'packages/*/spec-tests'
  outputDir: path.join(__dirname, "../../spec-tests"),
  specTestsRepoUrl: "https://github.com/ethereum/consensus-spec-tests",
  testsToDownload: ["general", "mainnet", "minimal"],
};

export const blsSpecTests: DownloadTestsOptions = {
  specVersion: "v0.1.1",
  // Target directory is the host package root: 'packages/*/spec-tests-bls'
  outputDir: path.join(__dirname, "../../spec-tests-bls"),
  specTestsRepoUrl: "https://github.com/ethereum/bls12-381-tests",
  testsToDownload: ["bls_tests_yaml"],
};
