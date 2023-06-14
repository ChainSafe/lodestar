import path from "node:path";

// From https://blog.logrocket.com/alternatives-dirname-node-js-es-modules
export function esmRelativePathResolve(relativePath: string): string {
  return new URL(relativePath, import.meta.url).toString().replace(/^file:\/\//, "");
}

export function repoRootPath(fileDirPath: string): string {
  return path.join(esmRelativePathResolve("../../../"), fileDirPath);
}

export const tsNodeBinaryPath = repoRootPath("node_modules/.bin/ts-node");
export const nodeJsBinaryPath = "node";
