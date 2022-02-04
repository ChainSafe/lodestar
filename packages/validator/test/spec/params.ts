import path from "node:path";

// Full link: https://github.com/eth2-clients/slashing-protection-interchange-tests/releases/download/v5.1.0/eip-3076-tests-v5.1.0.tar.gz
export const SPEC_TEST_VERSION = "v5.1.0";
export const TESTS_TO_DOWNLOAD = [`eip-3076-tests-${SPEC_TEST_VERSION}`];
export const SPEC_TEST_REPO_URL = "https://github.com/eth-clients/slashing-protection-interchange-tests";
export const SPEC_TEST_LOCATION = path.join(__dirname, "../../spec-tests");
