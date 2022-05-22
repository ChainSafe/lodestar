import {expect} from "chai";
import fs from "node:fs";
import path from "node:path";
import findUp from "find-up";
import {gitDataPath, readGitDataFile} from "../../../src/util/gitData/gitDataPath";
import {getGitData} from "../../../src/util";

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
