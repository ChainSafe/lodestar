#!/usr/bin/env node

import {downloadTestsAndManage} from "./downloadTests";

/* eslint-disable no-console */

async function downloadTestsCli(): Promise<void> {
  const [specVersion, outputDir, ...flags] = process.argv.slice(2);
  const cleanup = flags.includes("--cleanup");
  const force = flags.includes("--force");

  // Print help
  if (specVersion === "--help" || !specVersion || !outputDir) {
    return console.log(`
  USAGE: 
  
  eth2-spec-test-download [specVersion] [outputDir]

  Downloads tests to $outputDir/$specVersion

  --cleanup   Remove different test versions in outputDir
  --force     Download even if directory with same name exists

  EXAMPLE:

  eth2-spec-test-download v1.0.0 ./path/to/output-dir \n`);
  }

  await downloadTestsAndManage({specVersion, outputDir, cleanup, force}, console.log);
}

downloadTestsCli().catch((e) => {
  console.error(e);
  process.exit(1);
});
