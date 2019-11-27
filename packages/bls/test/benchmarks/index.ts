// Import benchmarks
import * as suites from "./suites";
import {createReportDir, runSuite} from "@chainsafe/benchmark-utils";
import {initLibrary} from "../../src";
// Create file
const directory: string = createReportDir();

initLibrary().then(() => {
  // Run benchmarks
  Object.values(suites).forEach((suite) => {
    runSuite(suite(directory));
  });
});