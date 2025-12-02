import fs from "node:fs";
import path from "node:path";

type IoError = {code: string};

/** Wait for file to exist have some content, then return its contents */
export async function readFileWhenExists(dirpath: string, filenameRx: RegExp): Promise<string> {
  for (let i = 0; i < 200; i++) {
    try {
      const files = fs.readdirSync(dirpath);
      const filename = files.find((file) => filenameRx.test(file));
      if (filename !== undefined) {
        const data = fs.readFileSync(path.join(dirpath, filename), "utf8").trim();
        // Winston will first create the file then write to it
        if (data) return data;
      }
    } catch (e) {
      if ((e as IoError).code !== "ENOENT") throw e;
    }
    await new Promise((r) => setTimeout(r, 10));
  }
  throw Error("Timeout");
}
