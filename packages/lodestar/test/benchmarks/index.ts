import {createReportDir} from "./utils"

// Import benchmarks
import * as benchmarks from "./imports";

// Create file
const directory: string = createReportDir();

// Run benchmarks
for (let bench in benchmarks) {
    benchmarks[bench](directory);
}