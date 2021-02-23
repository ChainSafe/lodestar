import {downloadTests} from "@chainsafe/lodestar-spec-test-util";
import {SPEC_TEST_LOCATION, SPEC_TEST_VERSION, SPEC_TEST_REPO_URL} from "./utils/specTestCases";

/* eslint-disable no-console */

downloadTests(
  {
    specTestsRepoUrl: SPEC_TEST_REPO_URL,
    specVersion: SPEC_TEST_VERSION,
    outputDir: SPEC_TEST_LOCATION,
  },
  console.log
).catch((e) => {
  console.error(e);
  process.exit(1);
});
