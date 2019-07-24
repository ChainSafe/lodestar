import fs from "fs";

export const createReportFile = (): string => {
    const curDate: string = new Date().toISOString();
    const dir: string = "./benchmark-reports/";
    const filename: string = dir + curDate + ".txt";

    // If benchmark directory doesn't exist create it
    if (!fs.existsSync(dir)){
        fs.mkdirSync(dir);
    }

    // Generate file and write to it
    fs.writeFile(filename, `Benchmarks for ${curDate}\r\n`, 'ascii', (err) => {
        if (err) throw err;
    })
    return filename;
}

export const appendReport = (file: string, data: string, end?: boolean) => {
    fs.appendFile(file, `\r\n${data}`, 'ascii', (err) => {
        if (err) throw err;
        if (end) {
            fs.appendFile(file, "\r\n-------------", 'ascii', (err) => {
                if (err) throw err;
            })
        }
    })
}