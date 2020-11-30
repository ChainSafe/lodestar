#!/usr/bin/env node

import fs from "fs";
import path from "path";
import rimraf from "rimraf";
import {downloadTests} from "./downloadTests";

/* eslint-disable no-console */

async function downloadTestsCli(): Promise<void> {
  const [specVersion, outputDirBase, ...flags] = process.argv.slice(2);
  const cleanup = flags.includes("--cleanup");
  const force = flags.includes("--force");

  // Print help
  if (specVersion === "--help" || !specVersion || !outputDirBase) {
    return console.log(`
  USAGE: 
  
  eth2-spec-test-download [specVersion] [outputDir]

  Downloads tests to $outputDir/$specVersion

  --cleanup   Remove different test versions in outputDir
  --force     Download even if directory with same name exists

  EXAMPLE:

  eth2-spec-test-download v1.0.0 ./path/to/output-dir \n`);
  }

  const outputDir = path.join(outputDirBase, specVersion);
  if (fs.existsSync(outputDir) && !force) {
    throw Error(`Path ${outputDir} already exists`);
  } else {
    fs.mkdirSync(outputDir, {recursive: true});
  }

  if (cleanup) {
    for (const dirpath of fs.readdirSync(outputDirBase)) {
      if (dirpath !== specVersion) {
        rimraf.sync(path.join(outputDirBase, dirpath));
      }
    }
  }

  await downloadTests({specVersion, outputDir}, console.log);
}

downloadTestsCli().catch((e) => {
  console.error(e);
  process.exit(1);
});
