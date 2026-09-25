import path from "node:path";
import {fileURLToPath} from "node:url";

// Global variable __dirname no longer available in ES6 modules.
// Solutions: https://stackoverflow.com/questions/46745014/alternative-for-dirname-in-node-js-when-using-es6-modules
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const SPEC_TEST_VERSION = "v5.3.0";
export const TESTS_TO_DOWNLOAD = [`eip-3076-tests-${SPEC_TEST_VERSION}`];
export const SPEC_TEST_REPO_URL = "https://github.com/eth-clients/slashing-protection-interchange-tests";
// Releases after v5.2.0 do not publish a tests tarball, download the source archive of the tag instead
export const SPEC_TEST_URLS = {
  [TESTS_TO_DOWNLOAD[0]]: `${SPEC_TEST_REPO_URL}/archive/refs/tags/${SPEC_TEST_VERSION}.tar.gz`,
};
export const SPEC_TEST_LOCATION = path.join(__dirname, "../../spec-tests");
export const SPEC_TEST_CASES_LOCATION = path.join(
  SPEC_TEST_LOCATION,
  `slashing-protection-interchange-tests-${SPEC_TEST_VERSION.slice(1)}`,
  "tests/generated"
);
