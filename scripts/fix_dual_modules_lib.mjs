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
import {getFilenameRecursively} from "./utils/get_filenames_recursively.mjs";

function getSwapPairs(prefix) {
  return {
    ".js": `.${prefix}js`,
    ".js.map": `.${prefix}js.map`,
    ".d.ts": `.d.${prefix}ts`,
    ".ts.map": `.${prefix}ts.map`,
  };
}

/**
 * Update internal references in map files for updated filenames.  Allows code
 * reference click-through, and intellisense, to work correctly
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

/**
 * Updates import and require statements in types and runtime files to end with
 * *.mjs or *.cjs to reference updated filenames
 */
function rewriteRequireStatements(filepath, swapPairs) {
  if (!(filepath.endsWith(".js") || filepath.endsWith("d.ts"))) {
    return;
  }
  let data = fs.readFileSync(filepath, "utf8");
  data = data.replace(/.js"\)/gi, `${swapPairs[".js"]}")`);
  data = data.replace(/.js";/gi, `${swapPairs[".js"]}";`);
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

function postBuildUpdates(dirname, swapPairs) {
  const filepaths = getFilenameRecursively(dirname);
  for (const filepath of filepaths) {
    rewriteRequireStatements(filepath, swapPairs);
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
  throw new Error("Must pass packageName as first positional param after calling script");
}

postBuildUpdates(path.resolve(__dirname, "..", "packages", packageName, "lib", "cjs"), getSwapPairs("c"));
postBuildUpdates(path.resolve(__dirname, "..", "packages", packageName, "lib", "esm"), getSwapPairs("m"));
