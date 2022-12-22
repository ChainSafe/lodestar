import fs from "node:fs";
import path from "node:path";

// ESM modules now reference build files on (package.json).exports
// This script ensure that the referenced files exist

const pkgsDirpath = path.resolve("./packages");
const exportPaths = [];

for (const pkgDirname of fs.readdirSync(pkgsDirpath)) {
  const pkgDirpath = path.join(pkgsDirpath, pkgDirname);
  const packageJSONPath = path.join(pkgDirpath, "package.json");
  if (!fs.existsSync(packageJSONPath)) {
    throw Error(`No package.json found in ${pkgDirpath}`);
  }

  const packageJSON = JSON.parse(fs.readFileSync(packageJSONPath, "utf8"));

  // {
  //   "exports": "./lib/index.js",
  // }
  if (typeof packageJSON.exports === "string") {
    exportPaths.push(path.join(pkgDirpath, packageJSON.exports));
  }

  // {
  //   "exports": {
  //     ".": {
  //       "import": "./lib/index.js"
  //     },
  // }
  else if (typeof packageJSON.exports === "object") {
    for (const [exportPath, exportObj] of Object.entries(packageJSON.exports)) {
      if (!exportObj.import) {
        throw Error(`package.json ${packageJSONPath} export ${exportPath} has not import`);
      }

      exportPaths.push(path.join(pkgDirpath, exportObj.import));
    }
  }
}

const missingExportPaths = exportPaths.filter((exportPath) => !fs.existsSync(exportPath));
if (missingExportPaths.length > 0) {
  throw Error(`export paths file(s) not found\n${missingExportPaths.join("\n")}`);
}
