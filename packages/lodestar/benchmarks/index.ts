import {createReportFile} from "./utils"

// Import benchmarks
import * as benchmarks from "./imports";

// Create file
const file = createReportFile();

// Run benchmarks
for (let bench in benchmarks) {
    benchmarks[bench](file);
}