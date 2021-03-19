/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import fs, {writeFile} from "fs";
import {BENCH_DIR} from "./constant";
import Benchmark from "benchmark";
import profiler from "v8-profiler-next";
import {dirname} from "path";

export type BenchSuite = {
  //to compare multiple function implementation speed, add array of implementations here
  //to check speed of different functions create multiple BenchSuites
  testFunctions: (() => void)[];
  file: string;
  name: string;
  setup?: () => void;
  teardown?: () => void;
  profile?: boolean;
};

export const createReportDir = (): string => {
  const curDate: string = new Date().toISOString();
  const dir: string = BENCH_DIR + `${curDate}/`;

  // If benchmark directory doesn't exist create it
  if (!fs.existsSync(BENCH_DIR)) {
    fs.mkdirSync(BENCH_DIR);
  }

  // Create the current benchmark folder
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir);
  }
  return dir;
};

export const writeReport = (file: string, data: string): void => {
  // eslint-disable-next-line no-console
  console.log(data);
  fs.appendFile(file, `\r\n${data}`, "ascii", (err) => {
    if (err) throw err;
  });
};

export const runSuite = (bench: BenchSuite, name?: string): void => {
  let suite = new Benchmark.Suite(name);
  const profileId = `${bench.name} - ${Date.now()}.profile`;
  for (const func of bench.testFunctions) {
    suite = suite.add(func.name, func, {setup: bench.setup, teardown: bench.teardown, minSamples: 2});
  }

  suite.on("start", function () {
    if (bench.profile) {
      profiler.startProfiling(profileId);
    }
  });
  suite.on("complete", function () {
    if (bench.profile) {
      const profile = profiler.stopProfiling(profileId);
      profile.export((error, result) => {
        if (error || !result) {
          return;
        }
        writeFile(`${dirname(bench.file)}/${profileId}`, result, () => {
          profile.delete();
        });
      });
    }
  });
  // add listeners
  suite
    .on("cycle", (event: Event) => {
      writeReport(bench.file, String(event.target));
    })
    // Scoping issue requires function decleration
    .on("complete", function () {
      //@ts-ignore
      for (const suite in this) {
        //@ts-ignore
        if (this.hasOwnProperty(suite) && !isNaN(parseInt(suite))) {
          //@ts-ignore
          const mean = (this[suite].stats.mean * 1000).toFixed(2);
          //@ts-ignore
          const msg = `${this[suite].name} took ${mean} ms on average`;
          writeReport(bench.file, msg);
        }
      }
      if (bench.testFunctions.length > 1) {
        //@ts-ignore
        const msg: string = "Fastest is " + this.filter("fastest").map("name");
        writeReport(bench.file, msg);
      }
    })
    .run();
};
