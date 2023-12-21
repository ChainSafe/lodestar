import {downloadTests} from "@lodestar/spec-test-util/downloadTests";
import {ethereumConsensusSpecsTests, blsSpecTests} from "./specTestVersioning.js";

/* eslint-disable no-console */

for (const downloadTestOpts of [ethereumConsensusSpecsTests, blsSpecTests]) {
  downloadTests(downloadTestOpts, console.log).catch((e: Error) => {
    console.error(e);
    process.exit(1);
  });
}
