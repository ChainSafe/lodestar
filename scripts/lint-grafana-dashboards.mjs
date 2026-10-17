#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import {formatGrafanaDashboard, lintGrafanaDashboard, readGrafanaDashboard} from "./lint-grafana-dashboard.mjs";

// USAGE:
// node scripts/lint-grafana-dashboards.mjs ./dashboards [--check]
//
// Rewrites each dashboard in its linted form, or with --check lists the dashboards that differ from it and fails.

const dirpath = process.argv[2];
if (!dirpath) throw Error("Must provide dirpath argument");
const check = process.argv.includes("--check");

const filenames = fs.readdirSync(dirpath);
if (filenames.length === 0) throw Error(`Empty dir ${dirpath}`);

const unlinted = [];
for (const filename of filenames) {
  if (!filename.endsWith(".json")) {
    continue;
  }

  const filepath = path.join(dirpath, filename);
  try {
    const linted = formatGrafanaDashboard(lintGrafanaDashboard(readGrafanaDashboard(filepath)));
    if (linted === fs.readFileSync(filepath, "utf8")) continue;
    if (check) unlinted.push(filepath);
    else fs.writeFileSync(filepath, linted);
  } catch (e) {
    e.message = `file ${filepath}: ${e.message}`;
    throw e;
  }
}

if (unlinted.length > 0) {
  console.error(`Dashboards need linting:\n${unlinted.join("\n")}`);
  process.exit(1);
}
