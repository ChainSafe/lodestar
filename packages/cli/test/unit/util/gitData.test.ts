import {expect} from "chai";
import fs from "node:fs";
import path from "node:path";
import findUp from "find-up";
import {gitDataPath, readGitDataFile} from "../../../src/util/gitData/gitDataPath";

describe("util / gitData", () => {
  it("gitData file must exist", () => {
    const gitData = readGitDataFile();

    if (!gitData.branch) throw Error("No gitData.branch");
    if (!gitData.commit) throw Error("No gitData.commit");
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
