#!/usr/bin/env node

import {spawnSync} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {fixtures} from "./grafana-dashboard-query-fixtures.mjs";
import {readGrafanaDashboard} from "./lint-grafana-dashboard.mjs";

// USAGE:
// node scripts/check-grafana-dashboard-queries.mjs ./dashboards
//
// Evaluates dashboard queries offline with `promtool test rules` against the canned series of
// `grafana-dashboard-query-fixtures.mjs`. Requires promtool on PATH.

const dirpath = process.argv[2];
if (!dirpath) throw Error("Must provide dirpath argument");

/** Grafana variables of the queries under test, as the offline evaluation reads them */
const variables = {rate_interval: "5m"};
/** Each canned series has a sample every minute until the evaluation time */
const evalTime = "40m";

/**
 * @param {any[] | undefined} panels
 * @returns {Generator<any>}
 */
function* walkPanels(panels) {
  for (const panel of panels ?? []) {
    yield panel;
    yield* walkPanels(panel.panels);
  }
}

const problems = [];
const dashboards = new Map();
for (const filename of fs.readdirSync(dirpath).filter((filename) => filename.endsWith(".json"))) {
  dashboards.set(filename, readGrafanaDashboard(path.join(dirpath, filename)));
}

const groups = [];
for (const {dashboard, panel: id, refId, cases} of fixtures) {
  const name = `${dashboard} #${id} ${refId}`;
  const panel = [...walkPanels(dashboards.get(dashboard)?.panels)].find((panel) => panel.id === id);
  const target = panel?.targets?.find((target) => target.refId === refId);
  if (!target?.expr) {
    problems.push(`${name}: no such query`);
    continue;
  }
  const expr = target.expr.replace(/\$(\w+)/g, (variable, key) => variables[key] ?? variable);
  if (expr.includes("$")) {
    problems.push(`${name}: unknown variable in ${expr}`);
    continue;
  }
  for (const {name: caseName, series, expect} of cases) {
    groups.push({
      name: `${name}: ${caseName}`,
      interval: "1m",
      input_series: Object.entries(series).map(([series, values]) => ({series, values})),
      promql_expr_test: [{expr, eval_time: evalTime, exp_samples: expect}],
    });
  }
}

if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}

// promtool reads YAML, of which JSON is a subset
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "dashboard-queries-"));
const testFile = path.join(testDir, "queries.json");
fs.writeFileSync(testFile, JSON.stringify({tests: groups}, null, 2));
const result = spawnSync("promtool", ["test", "rules", testFile], {encoding: "utf8"});
fs.rmSync(testDir, {recursive: true, force: true});
if (result.error) throw Error(`promtool is required on PATH: ${result.error.message}`);
if (result.status !== 0) {
  console.error(result.stdout, result.stderr);
  process.exit(1);
}
console.log(`${groups.length} dashboard query cases passed`);
