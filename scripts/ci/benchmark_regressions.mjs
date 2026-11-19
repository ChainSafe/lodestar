// Lists and summarizes the benches a benchmark run flagged as regressed, see .github/workflows/benchmark.yml
//
// node benchmark_regressions.mjs files <benchmark.log>
//   test files that contain a regressed bench, one per line
// node benchmark_regressions.mjs table <benchmark.log> <rerun.log>
//   markdown table of each regressed bench with its baseline, the nightly result and the re-run result
import fs from "node:fs";

const UNIT_NS = {ns: 1, us: 1e3, ms: 1e6, s: 1e9};
const FILE = /^(packages\/\S+\.test\.ts)$/;
const RESULT = /^\s*(✔|!)\s+(.+?)\s{2,}[\d.e+]+ ops\/s\s+([\d.e+-]+) (ns|us|ms|s)\/op(?:\s+x([\d.]+))?/;

function parse(logPath) {
  if (!fs.existsSync(logPath)) return [];
  const results = [];
  let file = null;
  for (const raw of fs.readFileSync(logPath, "utf8").split("\n")) {
    const line = raw.replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z /, "").replace(/\x1b\[[0-9;]*m/g, "");
    const fileMatch = line.trim().match(FILE);
    if (fileMatch) {
      file = fileMatch[1];
      continue;
    }
    const m = line.match(RESULT);
    if (m) {
      results.push({
        file,
        regressed: m[1] === "!",
        name: m[2],
        ns: Number(m[3]) * UNIT_NS[m[4]],
        ratio: m[5] === undefined ? null : Number(m[5]),
      });
    }
  }
  return results;
}

function threshold() {
  const m = fs.readFileSync(".benchrc.yaml", "utf8").match(/^threshold:\s*([\d.]+)/m);
  return m ? Number(m[1]) : 3;
}

function formatTime(ns) {
  for (const [unit, scale] of [["s", 1e9], ["ms", 1e6], ["us", 1e3]]) {
    if (ns >= scale) return `${(ns / scale).toPrecision(4)} ${unit}/op`;
  }
  return `${ns.toPrecision(4)} ns/op`;
}

const [cmd, logPath, rerunPath] = process.argv.slice(2);
const regressed = parse(logPath).filter((r) => r.regressed);

if (cmd === "files") {
  for (const file of new Set(regressed.map((r) => r.file).filter(Boolean))) console.log(file);
} else if (cmd === "table") {
  if (regressed.length === 0) process.exit(1);
  const limit = threshold();
  const rerun = parse(rerunPath);
  let reproduced = 0;
  let rerunCount = 0;
  console.log("| Benchmark | Baseline | Nightly | Re-run |");
  console.log("| --- | --- | --- | --- |");
  for (const r of regressed) {
    const baselineNs = r.ns / r.ratio;
    const again = rerun.findLast((x) => x.name === r.name);
    let rerunCell = "not re-run";
    if (again) {
      const ratio = again.ns / baselineNs;
      rerunCount++;
      if (ratio >= limit) reproduced++;
      rerunCell = `${formatTime(again.ns)} (x${ratio.toFixed(3)})`;
    }
    const name = r.name.replace(/\|/g, "\\|");
    console.log(`| \`${name}\` | ${formatTime(baselineNs)} | ${formatTime(r.ns)} (x${r.ratio.toFixed(3)}) | ${rerunCell} |`);
  }
  console.log();
  if (rerunCount === 0) {
    console.log("The regressed benches could not be re-run, see the job log");
  } else {
    console.log(
      `${reproduced} of ${rerunCount} re-run regressions stayed above the x${limit} threshold against the same baseline` +
        (reproduced === 0 ? ", likely noise" : "")
    );
  }
} else {
  console.error("usage: benchmark_regressions.mjs files <benchmark.log> | table <benchmark.log> <rerun.log>");
  process.exit(2);
}
