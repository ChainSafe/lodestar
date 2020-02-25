// Import benchmarks
import * as benchmarks from "./imports";
import {createReportDir, runSuite} from "@chainsafe/benchmark-utils";
// Create file
const directory: string = createReportDir();

// Run benchmarks
for (const bench in benchmarks) {
  // @ts-ignore
  runSuite(benchmarks[bench](directory));
}