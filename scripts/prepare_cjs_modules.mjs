/* eslint-disable
  quotes,
  @typescript-eslint/explicit-function-return-type,
  @typescript-eslint/no-unsafe-member-access,
  @typescript-eslint/no-unsafe-assignment,
  @typescript-eslint/naming-convention,
  @typescript-eslint/no-unsafe-return,
  @typescript-eslint/no-unsafe-call,
*/

import fs from "node:fs";
import url from "node:url";
import path from "node:path";

function getSwapPairs(prefix) {
  return {
    ".js": `.${prefix}js`,
    ".js.map": `.${prefix}js.map`,
    ".d.ts": `.d.${prefix}ts`,
    ".ts.map": `.${prefix}ts.map`,
  };
}

/**
 * Recursively walk directories and get list of all files in a folder
 */
function getAllFilesInFolder(dirname) {
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
      pathList.push(...getAllFilesInFolder(itemPath));
    }
    if (stat.isFile()) {
      pathList.push(itemPath);
    }
  }

  return pathList;
}

/**
 * Update internal references in map files for updated filenames
 */
function rewriteMapReferences(filepath, swapPairs) {
  if (!filepath.endsWith(".map")) return;
  const data = JSON.parse(fs.readFileSync(filepath, "utf8"));
  if (filepath.endsWith(".d.ts.map")) {
    data.file = data.file.replace(".d.ts", swapPairs[".d.ts"]);
  } else {
    data.file = data.file.replace(".js", swapPairs[".js"]);
  }
  fs.writeFileSync(filepath, JSON.stringify(data));
}

function rewriteRequireStatements(filepath) {
  let data = fs.readFileSync(filepath, "utf8");
  if (filepath.endsWith(".js")) {
    data = data.replace(/.js"\)/gi, '.cjs")');
  } else if (filepath.endsWith("d.ts")) {
    data = data.replace(/.js";/gi, '.cjs";');
  } else {
    return;
  }
  fs.writeFileSync(filepath, data);
}

/**
 * Rewrite file names from `.js` to `.cjs` or `.ts` to `.cts` including map files
 */
function rewriteFileName(filepath, swapPairs) {
  for (const [searchString, replacement] of Object.entries(swapPairs)) {
    if (filepath.endsWith(searchString)) {
      const newFilepath = filepath.replace(searchString, replacement);
      fs.renameSync(filepath, newFilepath);
      return;
    }
  }
}

function updateDistribution(dirname, swapPairs) {
  const filepaths = getAllFilesInFolder(dirname);
  for (const filepath of filepaths) {
    rewriteRequireStatements(filepath);
    rewriteMapReferences(filepath, swapPairs);
    rewriteFileName(filepath, swapPairs);
  }
}

/**
 *
 * File entrance below here
 *
 */
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

const packageName = process.argv[2];
if (!packageName) {
  throw new Error("Must pass packageName as positional param after calling script");
}

updateDistribution(path.resolve(__dirname, "..", "packages", packageName, "lib", "cjs"), getSwapPairs("c"));
updateDistribution(path.resolve(__dirname, "..", "packages", packageName, "lib", "esm"), getSwapPairs("m"));
