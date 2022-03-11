const fs = require("node:fs");
const path = require("node:path");

const dashboardsDir = path.join(__dirname, "../docker/grafana/provisioning/dashboards");

for (const dashboardName of fs.readdirSync(dashboardsDir)) {
  if (dashboardName.endsWith(".json")) {
    let lodestarDash = require(path.join(dashboardsDir, dashboardName));
    lodestarDash = JSON.stringify(lodestarDash); // get everything in the same line

    // match something like exemplar : true
    const matches = lodestarDash.match(/(exemplar)(\s)*(["])?(\s)*:(\s)*(["])?(\s)*true/gi);
    if (matches && matches.length > 0) {
      throw new Error(`ExemplarQueryNotSupported: ${dashboardName}`);
    }
  }
}
