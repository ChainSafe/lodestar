import Benchmark from "benchmark";
import {createReportDir, writeReport, runSuite} from "./utils"

// Import benchmarks
import * as benchmarks from "./imports";
import { BenchSuite } from "./examples";

// Create file
const directory: string = createReportDir();

// Run benchmarks
for (let bench in benchmarks) {
    runSuite(benchmarks[bench](directory));
}