import path from "node:path";

/**
 * Return the absolute path to a file relative to the current file
 * From https://blog.logrocket.com/alternatives-dirname-node-js-es-modules
 */
export function esmRelativePathResolve(relativePath: string): string {
  return new URL(relativePath, import.meta.url).toString().replace(/^file:\/\//, "");
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
