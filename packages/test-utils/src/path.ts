/* eslint-disable @typescript-eslint/naming-convention */
import url from "node:url";
import path from "node:path";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const __filename = path.basename(import.meta.url);
const filepath = path.resolve(__dirname, __filename);
/**
 * Return the absolute path to a file relative to the current file
 * From https://blog.logrocket.com/alternatives-dirname-node-js-es-modules
 */
export function esmRelativePathResolve(relativePath: string): string {
  return new URL(relativePath, filepath).toString().replace(/^file:\/\//, "");
}

/**
 * Return the path to the root of the repo
 */
export function repoRootPath(fileDirPath: string): string {
  return path.join(esmRelativePathResolve("../../../"), fileDirPath);
}

/**
 * Path to the node binary
 */
export const nodeJsBinaryPath = "node";
