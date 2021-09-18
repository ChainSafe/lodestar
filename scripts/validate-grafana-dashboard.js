let lodestarDash = require("../docker/grafana/provisioning/dashboards/lodestar.json");
lodestarDash = JSON.stringify(lodestarDash); //get everything in the same line

//match something like exemplar : true
const matches = lodestarDash.match(/(exemplar)(\s)*(["])?(\s)*:(\s)*(["])?(\s)*true/gi);
if (matches && matches.length > 0) throw new Error("ExemplarQueryNotSupported");
