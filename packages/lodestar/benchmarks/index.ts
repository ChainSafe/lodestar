import {createReportFile} from "./utils"

// Import benchmarks
// import * as benchmarks from "./imports"; // This doesn't seem to work
import * as benchmarks from "./example/example";

// Create file
const file = createReportFile();

// Run benchmarks
for (let bench in benchmarks) {
    benchmarks[bench](file);
}