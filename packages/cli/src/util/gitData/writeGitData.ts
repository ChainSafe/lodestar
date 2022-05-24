#!/usr/bin/env node

// For RATIONALE of this file, check packages/cli/src/util/gitData/gitDataPath.ts
// Persist exact commit in NPM distributions for easier tracking of the build

import {getGitData} from "./index.js";
import {writeGitDataFile} from "./gitDataPath.js";

// Script to write the git data file (json) used by the build procedures to persist git data.
writeGitDataFile(getGitData());
