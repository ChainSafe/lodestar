#!/usr/bin/env node

import {downloadTests, TestToDownload} from "./downloadTests";

/* eslint-disable no-console */

async function downloadTestsCli(): Promise<void> {
  const [specVersion, outputDir, testsToDownloadCsv] = process.argv.slice(2);

  // Print help
  if (specVersion === "--help" || !specVersion || !outputDir) {
    return console.log(`
  USAGE: 
  
  eth2-spec-test-download [specVersion] [outputDir] [testToDownload]

  Downloads tests to $outputDir/$specVersion 

  EXAMPLE:

  eth2-spec-test-download v1.0.0 ./spec-tests general,mainnet

  Results in:

  ./spec-tests/tests/general/phase0/bls/aggregate
  ./spec-tests/tests/general/phase0/bls/aggregate_verify
  ./spec-tests/tests/general/phase0/bls/fast_aggregate_verify
  `);
  }

  const testsToDownload = testsToDownloadCsv ? (testsToDownloadCsv.split(",") as TestToDownload[]) : undefined;
  await downloadTests({specVersion, outputDir, testsToDownload}, console.log);
}

downloadTestsCli().catch((e: Error) => {
  console.error(e);
  process.exit(1);
});
