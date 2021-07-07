#!/usr/bin/env node

import {writeGitDataFile} from "./gitDataPath";
import {getGitData} from "./index";

// Persist git data and distribute through NPM so CLI consumers can know exactly
// at what commit was this src build. This is used in the metrics and to log initially

writeGitDataFile(getGitData());
