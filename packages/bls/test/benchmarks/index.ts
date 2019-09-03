// Import benchmarks
import * as suites from "./suites";
import {createReportDir, runSuite} from "@chainsafe/benchmark-utils";
// Create file
const directory: string = createReportDir();


// Run benchmarks
Object.values(suites).forEach((suite) => {
  runSuite(suite(directory));
});