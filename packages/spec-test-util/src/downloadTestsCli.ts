#!/usr/bin/env ts-node

import {downloadTests, TestToDownload} from "./downloadTests.js";

/* eslint-disable no-console */

async function downloadTestsCli(): Promise<void> {
  const [specVersion, outputDir, testsToDownloadCsv] = process.argv.slice(2);

  // Print help
  if (specVersion === "--help" || !specVersion || !outputDir) {
    return console.log(`
  USAGE: 
  
  ./downloadTestsCli.ts [specVersion] [outputDir] [testToDownload]

  Downloads tests to $outputDir/$specVersion 

  EXAMPLE:

  ./downloadTestsCli.ts v1.0.0 ./spec-tests general,mainnet

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
