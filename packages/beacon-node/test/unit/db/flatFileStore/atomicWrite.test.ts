import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {atomicWrite, cleanupPartFiles, padSlot} from "../../../../src/db/flatFileStore/atomicWrite.js";

describe("atomicWrite", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "lodestar-atomic-"));
  });

  afterEach(async () => {
    await fs.promises.rm(tmpDir, {recursive: true, force: true});
  });

  it("should write file atomically", async () => {
    const target = path.join(tmpDir, "sub", "test.ssz");
    const data = new Uint8Array([1, 2, 3, 4]);

    await atomicWrite(target, data);

    const result = await fs.promises.readFile(target);
    expect(new Uint8Array(result)).toEqual(data);

    // .part file should not exist
    const partExists = await fs.promises
      .access(`${target}.part`)
      .then(() => true)
      .catch(() => false);
    expect(partExists).toBe(false);
  });

  it("should overwrite existing file", async () => {
    const target = path.join(tmpDir, "test.ssz");
    await atomicWrite(target, new Uint8Array([1]));
    await atomicWrite(target, new Uint8Array([2, 3]));

    const result = await fs.promises.readFile(target);
    expect(new Uint8Array(result)).toEqual(new Uint8Array([2, 3]));
  });
});

describe("cleanupPartFiles", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "lodestar-cleanup-"));
  });

  afterEach(async () => {
    await fs.promises.rm(tmpDir, {recursive: true, force: true});
  });

  it("should clean up .part files in subdirectories", async () => {
    const subDir = path.join(tmpDir, "000000000100");
    await fs.promises.mkdir(subDir, {recursive: true});
    await fs.promises.writeFile(path.join(subDir, "0xabc.ssz.part"), "partial");
    await fs.promises.writeFile(path.join(subDir, "0xdef.ssz"), "complete");

    const cleaned = await cleanupPartFiles(tmpDir);
    expect(cleaned).toBe(1);

    // Part file should be removed
    const partExists = await fs.promises
      .access(path.join(subDir, "0xabc.ssz.part"))
      .then(() => true)
      .catch(() => false);
    expect(partExists).toBe(false);

    // Complete file should remain
    const completeExists = await fs.promises
      .access(path.join(subDir, "0xdef.ssz"))
      .then(() => true)
      .catch(() => false);
    expect(completeExists).toBe(true);
  });

  it("should handle non-existent directory", async () => {
    const cleaned = await cleanupPartFiles("/nonexistent/path");
    expect(cleaned).toBe(0);
  });
});

describe("padSlot", () => {
  it("should pad to 12 digits", () => {
    expect(padSlot(0)).toBe("000000000000");
    expect(padSlot(1)).toBe("000000000001");
    expect(padSlot(123456789012)).toBe("123456789012");
  });
});
