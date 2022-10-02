#!/usr/bin/env ts-node

import {downloadTests} from "./downloadTests.js";

/* eslint-disable no-console */

async function downloadTestsCli(): Promise<void> {
  const [specVersion, outputDir, testsToDownloadCsv, specTestsRepoUrl] = process.argv.slice(2);

  // Print help
  if (specVersion === "--help" || !specVersion || !outputDir || !testsToDownloadCsv || !specTestsRepoUrl) {
    return console.log(`
  USAGE: 
  
  ./downloadTestsCli.ts [specVersion] [outputDir] [testToDownload] [specTestsRepoUrl]

  Downloads tests to $outputDir/$specVersion 

  EXAMPLE:

  ./downloadTestsCli.ts v1.0.0 ./spec-tests general,mainnet

  Results in:

  ./spec-tests/tests/general/phase0/bls/aggregate
  ./spec-tests/tests/general/phase0/bls/aggregate_verify
  ./spec-tests/tests/general/phase0/bls/fast_aggregate_verify
  `);
  }

  const testsToDownload = testsToDownloadCsv.split(",");
  await downloadTests({specVersion, outputDir, testsToDownload, specTestsRepoUrl}, console.log);
}

downloadTestsCli().catch((e: Error) => {
  console.error(e);
  process.exit(1);
});
