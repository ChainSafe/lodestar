#!/usr/bin/env node

import {downloadTests} from "./downloadTests";

/* eslint-disable no-console */

const [specVersion, outputDir] = process.argv.slice(2);

// Print help
if (specVersion === "--help" || !specVersion || !outputDir) {
  console.log(`
  USAGE: 
  
  eth2-spec-test-download [specVersion] [outputDir]

  EXAMPLE:

  eth2-spec-test-download v1.0.0 ./path/to/output-dir \n`);
  process.exit(0);
}

downloadTests({
  specVersion,
  outputDir,
})
  .then(() => {
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
