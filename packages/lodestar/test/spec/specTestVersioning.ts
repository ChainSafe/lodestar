import path from "node:path";

// WARNING! Don't move or rename this file !!!
//
// This file is used to generate the cache ID for spec tests download in Github Actions CI
// It's path is hardcoded in: `.github/workflows/test-spec.yml`
//
// The contents of this file MUST include the URL, version and target path, and nothing else.

export const SPEC_TEST_REPO_URL = "https://github.com/ethereum/consensus-spec-tests";
export const SPEC_TEST_VERSION = "v1.1.10";
// Target directory is the host package root: 'packages/*/spec-tests'
export const SPEC_TEST_LOCATION = path.join(__dirname, "../../spec-tests");
