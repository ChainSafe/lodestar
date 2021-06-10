/* eslint-disable */
const fs = require("fs");
const {execSync} = require("child_process");

// Persist git data and distribute through NPM so CLI consumers can know exactly
// at what commit was this src build. This is used in the metrics and to log initially

const shell = (cmd) => execSync(cmd).toString().trim();

const version = JSON.parse(fs.readFileSync("package.json")).version;
const branch = shell("git rev-parse --abbrev-ref HEAD");
const commit = shell("git rev-parse --verify HEAD");

const data = {version, branch, commit};
const versionDataFile = process.argv[2];
fs.writeFileSync(versionDataFile, JSON.stringify(data, null, 2));
console.log(data);
