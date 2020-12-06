// Import benchmarks
import * as benchmarks from "./imports";
import {createReportDir, runSuite} from "@chainsafe/benchmark-utils";
// Create file
const directory: string = createReportDir();

// Run benchmarks
for (const benchFn of Object.values(benchmarks)) {
  // @ts-ignore
  runSuite(benchFn(directory));
}
