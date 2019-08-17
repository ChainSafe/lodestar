import fs from "fs";
import {BENCH_DIR} from "./constant";
import Benchmark from "benchmark";

export interface BenchSuite {
  testFunctions: Function[];
  file: string;
  setup?: Function;
  teardown?: Function;
}

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

export const writeReport = (file: string, data: string) => {
  console.log(data);
  fs.appendFile(file, `\r\n${data}`, 'ascii', (err) => {
    if (err) throw err;
  });
};

export const runSuite = (bench: BenchSuite, name?: string) => {
  let suite = new Benchmark.Suite(name);
  bench.testFunctions.forEach((func) => {
    suite = suite.add(func.name, func, {setup: bench.setup, teardown: bench.teardown});
  });
  // add listeners
  suite.on('cycle', (event) => {
    writeReport(bench.file, String(event.target));
  })
  // Scoping issue requires function decleration
    .on('complete', function() {
      const msg: string = 'Fastest is ' + this.filter('fastest').map('name');
      writeReport(bench.file, msg);
    })
  // run async
    .run({'async': true});
};