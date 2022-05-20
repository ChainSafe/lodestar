import {expect} from "chai";
import fs from "node:fs";
import path from "node:path";
import findUp from "find-up";
import {fileURLToPath} from "node:url";
import {gitDataPath, readGitDataFile} from "../../../src/util/gitData/gitDataPath.js";
import {getGitData} from "../../../src/util/index.js";

// Global variable __dirname no longer available in ES6 modules.
// Solutions: https://stackoverflow.com/questions/46745014/alternative-for-dirname-in-node-js-when-using-es6-modules
// eslint-disable-next-line @typescript-eslint/naming-convention
const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("util / gitData", function () {
  // .gitData file is created at build time with the command
  // ```
  // npm run write-git-data
  // ```
  // If this step fails run that command. This could happen when running tests before building.
  it("gitData file must exist", () => {
    const gitData = readGitDataFile();

    expect(gitData).to.deep.equal(getGitData(), "Wrong git-data.json contents");
  });

  it("gitData path must be included in the package.json", () => {
    const pkgJsonPath = findUp.sync("package.json", {cwd: __dirname});
    if (!pkgJsonPath) {
      throw Error("No package.json found");
    }

    const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8")) as {files: string[]};
    const gitDataPathFromPkgJson = path.relative(path.dirname(pkgJsonPath), gitDataPath);

    expect(pkgJson.files).to.include(gitDataPathFromPkgJson, "package.json .files does not include gitData path");
  });
});
