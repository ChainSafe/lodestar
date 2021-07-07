#!/usr/bin/env node

import fs from "fs";
import {gitDataPath, GitDataFile} from "../gitDataPath";

// Run this in CI only to ensure the gitData file is properly generated

const gitData = JSON.parse(fs.readFileSync(gitDataPath, "utf8")) as GitDataFile;

// eslint-disable-next-line no-console
console.log({gitDataPath, gitData});

if (gitData.semver) throw Error("No gitData.semver");
if (gitData.branch) throw Error("No gitData.branch");
if (gitData.commit) throw Error("No gitData.commit");
