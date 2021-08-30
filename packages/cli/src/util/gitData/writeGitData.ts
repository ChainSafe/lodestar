#!/usr/bin/env node

/**
 * Persist git data and distribute through NPM so CLI consumers can know exactly
 * at what commit was this source build. This is also used in the metrics and to log initially.
 */

import {writeGitDataFile} from "./gitDataPath";
import {forceUpdateGitData} from "./index";

/** Script to write the git data file (json) used by the build procedures to persist git data. */
writeGitDataFile(forceUpdateGitData());
