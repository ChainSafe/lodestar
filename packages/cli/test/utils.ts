import fs from "node:fs";
import path from "node:path";
import tmp from "tmp";
import {createWinstonLogger, Logger} from "@lodestar/utils";

export const networkDev = "dev";

const tmpDir = tmp.dirSync({unsafeCleanup: true});
export const testFilesDir = tmpDir.name;

export const testLogger = (): Logger => createWinstonLogger();

export function getTestdirPath(filepath: string): string {
  const fullpath = path.join(testFilesDir, filepath);
  fs.mkdirSync(path.dirname(fullpath), {recursive: true});
  return fullpath;
}
