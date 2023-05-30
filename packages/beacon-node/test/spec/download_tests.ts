import {downloadTests} from "@lodestar/spec-test-util";
import {ethereumConsensusSpecsTests, blsSpecTests} from "./spec_test_versioning.js";

/* eslint-disable no-console */

for (const downloadTestOpts of [ethereumConsensusSpecsTests, blsSpecTests]) {
  downloadTests(downloadTestOpts, console.log).catch((e: Error) => {
    console.error(e);
    process.exit(1);
  });
}
