/* eslint-disable
  @typescript-eslint/explicit-function-return-type,
  @typescript-eslint/no-unsafe-return,
*/

import fs from "node:fs";
import path from "node:path";

/**
 * Recursively walk directories and get list of all files in a folder
 */
export function getFilenameRecursively(dirname) {
  if (!fs.existsSync(dirname)) {
    throw new Error(`No folder found at ${dirname}`);
  }

  const pathList = [];
  for (const filename of fs.readdirSync(dirname)) {
    const itemPath = path.resolve(dirname, filename);
    const stat = fs.statSync(itemPath);
    if (stat.isSymbolicLink()) {
      continue;
    }
    if (stat.isDirectory()) {
      pathList.push(...getFilenameRecursively(itemPath));
    }
    if (stat.isFile()) {
      pathList.push(itemPath);
    }
  }

  return pathList;
}
