import fs from "node:fs";
import path from "node:path";

// USAGE:
// node validate-grafana-dashboard.mjs ./dashboards

const dirpath = process.argv[2];
if (!dirpath) throw Error("Must provide dirpath argument");

const filenames = fs.readdirSync(dirpath);
if (filenames.length === 0) throw Error(`Empty dir ${dirpath}`);

for (const filename of filenames) {
  if (filename.endsWith(".json")) {
    const jsonStr = fs.readFileSync(path.join(dirpath, filename), "utf8");
    // get everything in the same line
    const jsonStrSameLine = JSON.stringify(JSON.parse(jsonStr));

    // match something like exemplar : true
    const matches = jsonStrSameLine.match(/(exemplar)(\s)*(["])?(\s)*:(\s)*(["])?(\s)*true/gi);
    if (matches && matches.length > 0) {
      throw new Error(`ExemplarQueryNotSupported: ${filename}`);
    }
  }
}
