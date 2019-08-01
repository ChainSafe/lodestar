import fs from "fs";
import { BENCH_DIR } from "../constant";
import { BenchSuite } from "../examples";

export const createReportDir = (): string => {
    const curDate: string = new Date().toISOString();
    const dir: string = BENCH_DIR + `${curDate}/`;

    // If benchmark directory doesn't exist create it
    if (!fs.existsSync(BENCH_DIR)) {
        fs.mkdirSync(BENCH_DIR);
    }

    // Create the current benchmark folder
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir)
    }
    return dir;
}

export const writeReport = (file: string, data: string) => {
    fs.appendFile(file, `\r\n${data}`, 'ascii', (err) => {
        if (err) throw err;
    })
}

export const runSuite = (bench: BenchSuite) => {
    bench.suite
    // add listeners
    .on('cycle', (event) => {
        writeReport(bench.file, String(event.target));
    })
    // Scoping issue requires function decleration
    .on('complete', function() {
        const msg: string = 'Fastest is ' + this.filter('fastest').map('name');
        writeReport(bench.file, msg);
    })
    // run async
    .run({ 'async': true });
}