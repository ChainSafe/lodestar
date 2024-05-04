/* eslint-disable
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

/**
 * Comment and uncomment declarations of __dirname and __filename in module style
 * typescript source files so that transpilation works correctly for cjs
 */
function handleDirnameAndFilename(dirname, isPre) {
  const filepaths = getFilenameRecursively(dirname);
  for (const filepath of filepaths) {
    let data = fs.readFileSync(filepath, "utf8");
    if (isPre) {
      data = data.replace("const __dirname", "// const __dirname");
      data = data.replace("const __filename", "// const __filename");
    } else {
      data = data.replace("// const __dirname", "const __dirname");
      data = data.replace("// const __filename", "const __filename");
    }
    fs.writeFileSync(filepath, data);
  }
}

/**
 *
 * File entrance below here
 *
 */
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

const preOrPost = process.argv[2];
if (!(preOrPost === "pre" || preOrPost === "post")) {
  throw new Error("Must pass 'pre' or 'post as first positional param after calling script");
}

const packageName = process.argv[3];
if (!packageName) {
  throw new Error("Must pass packageName as second positional param after calling script");
}

handleDirnameAndFilename(path.resolve(__dirname, "..", "packages", packageName, "src"), preOrPost === "pre");
