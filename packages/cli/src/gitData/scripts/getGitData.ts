#!/usr/bin/env node

import fs from "fs";
import path from "path";
import {execSync} from "child_process";
import {GitDataFile, gitDataPath} from "../gitDataPath";

function shell(cmd: string): string {
  return execSync(cmd, {stdio: ["ignore", "pipe", "ignore"]})
    .toString()
    .trim();
}

function getBranch(): string | undefined {
  try {
    return shell("git rev-parse --abbrev-ref HEAD");
  } catch (e) {
    return undefined;
  }
}

function getCommit(): string | undefined {
  try {
    return shell("git rev-parse --verify HEAD");
  } catch (e) {
    return undefined;
  }
}

function readPackageJsonVersion(): string | undefined {
  try {
    // Expects this script to be located at 'packages/cli/scripts/getGitData.js'
    const packageJsonPath = path.resolve(__dirname, "../package.json");
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {version: string};
    return packageJson.version;
  } catch (e) {
    return undefined;
  }
}

// Persist git data and distribute through NPM so CLI consumers can know exactly
// at what commit was this src build. This is used in the metrics and to log initially

const semver = readPackageJsonVersion();
const branch = getBranch();
const commit = getCommit();

const gitData: GitDataFile = {semver, branch, commit};
fs.writeFileSync(gitDataPath, JSON.stringify(gitData, null, 2));
