import fs from "fs";
import { BENCH_DIR } from "../constant";

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