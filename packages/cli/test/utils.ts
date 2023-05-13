import fs from "node:fs";
import path from "node:path";
import tmp from "tmp";
import {getEnvLogger} from "@lodestar/logger";

export const networkDev = "dev";

const tmpDir = tmp.dirSync({unsafeCleanup: true});
export const testFilesDir = tmpDir.name;

export const testLogger = getEnvLogger;

export function getTestdirPath(filepath: string): string {
  const fullpath = path.join(testFilesDir, filepath);
  fs.mkdirSync(path.dirname(fullpath), {recursive: true});
  return fullpath;
}

export function isTruthy<T = unknown>(value: T | undefined | null): value is T {
  return value !== undefined && value !== null;
}
