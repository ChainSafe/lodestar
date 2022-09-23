import fs from "node:fs";
import path from "node:path";

// Ensures that all metrics produced by Lodestar are used

const dashboardsDir = "./dashboards";
const metricsSrcDirpaths = [
  // Our own metrics
  "packages/beacon-node/src/metrics/metrics",
  // Metrics declared in gossipsub src
  "node_modules/libp2p-gossipsub/src/metrics.js",
];

/** @type {string[]} */
const unusedLabelNames = [];
/** @type {string[]} */
const allLabelNames = [];
let dashboardStrs = "";

for (const filename of fs.readdirSync(dashboardsDir)) {
  const filepath = path.join(dashboardsDir, filename);
  const dashboardStr = fs.readFileSync(filepath, "utf8");
  dashboardStrs += dashboardStr;
}

for (const metricsSrcDirpath of metricsSrcDirpaths) {
  const filepaths = fs.statSync(metricsSrcDirpath).isDirectory()
    ? fs.readdirSync(metricsSrcDirpath).map((filename) => path.join(metricsSrcDirpath, filename))
    : [metricsSrcDirpath];

  for (const filepath of filepaths) {
    const tsSource = fs.readFileSync(filepath, "utf8");

    // Grab `name: "lodestar_db_read_req_total",`
    // Match any alphanumeric character plus underscore
    const matches = tsSource.matchAll(/name:\s['"]([a-zA-Z0-9_]+)['"]/g);

    for (const match of matches) {
      const labelName = match[1];
      allLabelNames.push(labelName);

      if (!dashboardStrs.includes(labelName)) {
        unusedLabelNames.push(match[1]);
      }
    }
  }
}

console.log("Found label names", JSON.stringify(allLabelNames, null, 2));

if (unusedLabelNames.length > 0) {
  throw Error(`Found unused metrics\n${unusedLabelNames.join("\n")}`);
}
