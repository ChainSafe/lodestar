import {downloadTests} from "@chainsafe/lodestar-spec-test-util";
import {SPEC_TEST_LOCATION, SPEC_TEST_VERSION} from "./utils/specTestCases";

/* eslint-disable no-console */

downloadTests({
  specVersion: SPEC_TEST_VERSION,
  outputDir: SPEC_TEST_LOCATION,
})
  .then(() => {
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
