import {expect} from "chai";
import child_process from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import findUp from "find-up";
import {gitDataPath, readGitDataFile} from "../../../src/util/gitData/gitDataPath";
import {getGitData} from "../../../src/util";

const WRITE_GIT_DATA_CMD = "npm run write-git-data";

describe("util / gitData", () => {
  before(() => {
    const pkgJsonPath = findUp.sync("package.json", {cwd: __dirname});
    if (!pkgJsonPath) {
      throw Error("No package.json found");
    }

    const pkgJsonDir = path.resolve(path.dirname(pkgJsonPath));
    child_process.execSync(WRITE_GIT_DATA_CMD, {cwd: pkgJsonDir});
  });

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
