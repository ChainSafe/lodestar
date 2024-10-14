import fs from "node:fs";
import path from "node:path";
import {describe, it, expect, beforeAll, afterAll} from "vitest";
import {ensureDir, writeIfNotExist} from "../../../src/util/file.js";

describe("file util", () => {
  const dirPath = path.join(".", "keys/toml/test_config.toml");

  describe("ensureDir", () => {
    it("create dir if not exists", async () => {
      // ${dirPath} should not exist
      expect(fs.existsSync(dirPath)).toBe(false);
      await ensureDir(dirPath);
      // ${dirPath} should exist
      expect(fs.existsSync(dirPath)).toBe(true);
      fs.rmdirSync(dirPath);
    });
  });

  describe("writeIfNotExist", () => {
    const filePath = path.join(dirPath, "test.txt");
    const data = new Uint8Array([0, 1, 2]);
    beforeAll(async () => {
      await ensureDir(dirPath);
    });

    afterAll(() => {
      fs.rmdirSync(dirPath);
    });

    it("write to a non-existed file", async () => {
      expect(fs.existsSync(filePath)).toBe(false);
      expect(await writeIfNotExist(filePath, data)).toBe(true);
      const bytes = fs.readFileSync(filePath);
      expect(new Uint8Array(bytes)).toEqual(data);

      // clean up
      fs.rmSync(filePath);
    });

    it("write to an existing file", async () => {
      fs.writeFileSync(filePath, new Uint8Array([3, 4]));
      expect(await writeIfNotExist(filePath, data)).toBe(false);
      const bytes = fs.readFileSync(filePath);
      expect(new Uint8Array(bytes)).not.toEqual(data);

      // clean up
      fs.rmSync(filePath);
    });
  });
});
