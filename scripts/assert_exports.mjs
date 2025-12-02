import fs from "node:fs";
import path from "node:path";

// ESM modules now reference build files on (package.json).exports
// This script ensure that the referenced files exist

const pkgsDirpath = path.resolve("./packages");

function getExportPaths(pkgDirPath, pkgExports) {
  // {
  //   "exports": "./lib/index.js",
  // }
  if (typeof pkgExports === "string") {
    return [pkgExports];
  }

  // {
  //   "exports": {
  //     ".": {
  //       "import": "./lib/index.js"
  //     },
  // }
  const exportPaths = [];
  for (const [exportPath, nestedExportObj] of Object.entries(pkgExports)) {
    if (typeof nestedExportObj === "object") {
      exportPaths.push(...getExportPaths(pkgDirPath, nestedExportObj));
    } else if (typeof nestedExportObj === "string") {
      exportPaths.push(nestedExportObj);
    }
  }

  return exportPaths;
}

for (const pkgDirname of fs.readdirSync(pkgsDirpath)) {
  const pkgDirpath = path.join(pkgsDirpath, pkgDirname);
  const packageJSONPath = path.join(pkgDirpath, "package.json");
  if (!fs.existsSync(packageJSONPath)) {
    throw Error(`No package.json found in ${pkgDirpath}`);
  }

  const packageJSON = JSON.parse(fs.readFileSync(packageJSONPath, "utf8"));
  const exportPaths = getExportPaths(pkgDirpath, packageJSON.exports);
  const missingExportPaths = exportPaths.filter((exportPath) => !fs.existsSync(path.join(pkgDirpath, exportPath)));

  if (missingExportPaths.length > 0) {
    throw Error(`export paths file(s) not found\n${missingExportPaths.join("\n")}`);
  }
}
