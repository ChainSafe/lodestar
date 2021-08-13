#!/usr/bin/env node

import {writeGitDataFile} from "./gitDataPath";
import {getGitData} from "./index";

/** Script to write the git data file (json) used by the build procedures to persist git data. */
writeGitDataFile(getGitData());
