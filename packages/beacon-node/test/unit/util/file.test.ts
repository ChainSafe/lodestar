import fs from "node:fs";
import path from "node:path";
import {expect} from "chai";
import {ensureDir, writeIfNotExist} from "../../../src/util/file.js";

describe("file util", function () {
  this.timeout(3000);
  const dirPath = path.join(".", "keys/toml/test_config.toml");

  describe("ensureDir", function () {
    it("create dir if not exists", async () => {
      expect(fs.existsSync(dirPath), `${dirPath} should not exist`).to.be.false;
      await ensureDir(dirPath);
      expect(fs.existsSync(dirPath), `${dirPath} should exist`).to.be.true;
      fs.rmdirSync(dirPath);
    });
  });

  describe("writeIfNotExist", function () {
    const filePath = path.join(dirPath, "test.txt");
    const data = new Uint8Array([0, 1, 2]);
    before(async () => {
      await ensureDir(dirPath);
    });

    after(() => {
      fs.rmdirSync(dirPath);
    });

    it("write to a non-existed file", async () => {
      expect(fs.existsSync(filePath)).to.be.false;
      expect(await writeIfNotExist(filePath, data)).to.be.true;
      const bytes = fs.readFileSync(filePath);
      expect(new Uint8Array(bytes)).to.be.deep.equals(data);

      // clean up
      fs.rmSync(filePath);
    });

    it("write to an existing file", async () => {
      fs.writeFileSync(filePath, new Uint8Array([3, 4]));
      expect(await writeIfNotExist(filePath, data)).to.be.false;
      const bytes = fs.readFileSync(filePath);
      expect(new Uint8Array(bytes)).not.to.be.deep.equals(data);

      // clean up
      fs.rmSync(filePath);
    });
  });
});
