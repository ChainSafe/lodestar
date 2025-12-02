#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import {lintGrafanaDashboard, readGrafanaDashboard, writeGrafanaDashboard} from "./lint-grafana-dashboard.mjs";

// USAGE:
// node scripts/lint-grafana-dashboards.mjs ./dashboards

const dirpath = process.argv[2];
if (!dirpath) throw Error("Must provide dirpath argument");

const filenames = fs.readdirSync(dirpath);
if (filenames.length === 0) throw Error(`Empty dir ${dirpath}`);

for (const filename of filenames) {
  if (!filename.endsWith(".json")) {
    continue;
  }

  const filepath = path.join(dirpath, filename);
  try {
    const json = lintGrafanaDashboard(readGrafanaDashboard(filepath));
    writeGrafanaDashboard(filepath, json);
  } catch (e) {
    e.message = `file ${filepath}: ${e.message}`;
    throw e;
  }
}
