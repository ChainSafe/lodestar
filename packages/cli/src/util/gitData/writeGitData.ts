#!/usr/bin/env node

import {writeGitDataFile} from "./gitDataPath";
import {_forceUpdateGitData} from "./index";

/** Script to write the git data file (json) used by the build procedures to persist git data. */
writeGitDataFile(_forceUpdateGitData());
