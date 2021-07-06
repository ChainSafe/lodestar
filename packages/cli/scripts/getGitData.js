/* eslint-disable */
const fs = require("fs");
const {execSync} = require("child_process");
const shell = (cmd) =>
  execSync(cmd, {stdio: ["ignore", "pipe", "ignore"]})
    .toString()
    .trim();

function getGitData() {
  try {
    const branch = shell("git rev-parse --abbrev-ref HEAD");
    const commit = shell("git rev-parse --verify HEAD");
    return {branch, commit};
  } catch (e) {
    return {};
  }
}

// Persist git data and distribute through NPM so CLI consumers can know exactly
// at what commit was this src build. This is used in the metrics and to log initially

const version = JSON.parse(fs.readFileSync("package.json")).version;
const gitData = getGitData();
const branch = gitData?.branch || "-";
const commit = gitData?.commit || "-";

const data = {version, branch, commit};
const versionDataFile = process.argv[2];
fs.writeFileSync(versionDataFile, JSON.stringify(data, null, 2));
