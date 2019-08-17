// Import benchmarks
import * as benchmarks from "./imports";
import {createReportDir, runSuite} from "@chainsafe/benchmark-utils";
// Create file
const directory: string = createReportDir();

// Run benchmarks
for (let bench in benchmarks) {
  runSuite(benchmarks[bench](directory));
}