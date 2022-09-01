#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

// USAGE:
// node validate-grafana-dashboard.mjs ./dashboards

/* eslint-disable
@typescript-eslint/no-unsafe-assignment,
@typescript-eslint/explicit-function-return-type,
no-console
*/

const dirpath = process.argv[2];
if (!dirpath) throw Error("Must provide dirpath argument");

const filenames = fs.readdirSync(dirpath);
if (filenames.length === 0) throw Error(`Empty dir ${dirpath}`);

/** @type {string[]} */
const errors = [];

for (const filename of filenames) {
  if (!filename.endsWith(".json")) {
    continue;
  }

  const jsonStr = fs.readFileSync(path.join(dirpath, filename), "utf8");
  const json = JSON.parse(jsonStr);

  for (const errorStr of [assertNoExemplar(json), assertLodestarTag(json), assertLinks(json)]) {
    if (errorStr) {
      errors.push(`${filename}: ${errorStr}`);
    }
  }
}

if (errors.length > 0) {
  throw Error(`Some dashboards are invalid:\n${errors.join("\n")}`);
}

/**
 * The complete Triforce, or one or more components of the Triforce.
 * @typedef {Object} Dashboard
 * @property {string[]} tags
 * @property {Object[]} links
 */

function assertNoExemplar(json) {
  // get everything in the same line
  const jsonStrSameLine = JSON.stringify(json);

  // match something like exemplar : true
  const matches = jsonStrSameLine.match(/(exemplar)(\s)*(["])?(\s)*:(\s)*(["])?(\s)*true/gi);
  if (matches && matches.length > 0) {
    return "ExemplarQueryNotSupported, replace '\"exemplar\": true' with '\"exemplar\": false'";
  }
}

/** @param {Dashboard} json */
function assertLodestarTag(json) {
  if (!json.tags.includes("lodestar")) {
    return "Dashboard .tags must include 'lodestar'";
  }
}

/** @param {Dashboard} json */
function assertLinks(json) {
  if (!json.links.some((link) => link.type === "dashboards")) {
    return `Dashboard .links must include a link object with 
    {
      "asDropdown": true,
      "icon": "external link",
      "includeVars": true,
      "keepTime": true,
      "tags": ["lodestar"],
      "targetBlank": false,
      "title": "Lodestar dashboards",
      "tooltip": "",
      "type": "dashboards",
      "url": ""
    }
    `;
  }
}
