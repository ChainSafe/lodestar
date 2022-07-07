import fs from "node:fs";
import path from "node:path";
import {exitIf, help} from "./utils.mjs";

/* eslint-disable no-console, @typescript-eslint/no-unsafe-return, @typescript-eslint/explicit-function-return-type */

// TODO: Allow to customize
const workspacesPath = "./packages";

// Must clean version, could have 'v' prefix
const version = (process.argv[2] ?? "").replace(/^v/, "");
const range = process.argv[3];
const rangeValues = ["caret", "tilde", "exact"];

help(`
Set new version across all monorepo packages

Usage:
  set_version_dev <version> <${rangeValues.join("|")}>

See https://github.com/ChainSafe/lodestar/blob/unstable/RELEASE.md#1-create-release-candidate
`);
exitIf(!version, "<version> not set");
exitIf(!range, "<range> not set");
exitIf(!rangeValues.includes(range), "invalid range value");

const versionRange =
  range === "caret"
    ? // caret (^) x.*.*
      `^${version}`
    : range === "tilde"
    ? // tilde (~) x.x.*
      `~${version}`
    : // exact () x.x.x
      version;

/** @type {Set<string>} */
const pkgsNames = new Set();
forEachPkg((pkg) => {
  pkgsNames.add(pkg.name);
});

forEachPkg((pkg) => {
  pkg.version = version;
  for (const depName of Object.keys(pkg.dependencies ?? {})) {
    if (pkgsNames.has(depName)) {
      pkg.dependencies[depName] = versionRange;
    }
  }
  return pkg;
});

/**
 * Iterate over all package.json in the workspace, and overwrite if `cb()` returns a value
 * @param {(pkg: PkgJson) => PkgJson | undefined} cb
 */
function forEachPkg(cb) {
  for (const dirname of fs.readdirSync(workspacesPath)) {
    try {
      const pkgPath = path.join(workspacesPath, dirname, "package.json");
      if (fs.existsSync(pkgPath)) {
        const pkg = readPkg(pkgPath);
        const newPkg = cb(pkg);
        if (newPkg) {
          // Append new line to reduce diff when modifying manually
          fs.writeFileSync(pkgPath, JSON.stringify(newPkg, null, 2) + "\n");
        }
      }
    } catch (e) {
      e.message = `Error on package ${dirname}: ${e.message}`;
      throw e;
    }
  }
}

/**
 * Type package.json
 * @param {string} pkgPath
 * @typedef {Object} PkgJson
 * @property {string} name `"@lodestar/validator"`
 * @property {string} version `"0.39.0"`
 * @property {Record<string, string>} dependencies
 * @return {PkgJson}
 */
function readPkg(pkgPath) {
  return JSON.parse(fs.readFileSync(pkgPath, "utf8"));
}
