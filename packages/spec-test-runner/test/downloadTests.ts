import {downloadTestsAndManage} from "@chainsafe/lodestar-spec-test-util";
import {SPEC_TEST_LOCATION, SPEC_TEST_VERSION} from "./utils/specTestCases";

/* eslint-disable no-console */

downloadTestsAndManage(
  {
    specVersion: SPEC_TEST_VERSION,
    outputDir: SPEC_TEST_LOCATION,
    cleanup: true,
    force: true,
  },
  console.log
).catch((e) => {
  console.error(e);
  process.exit(1);
});
