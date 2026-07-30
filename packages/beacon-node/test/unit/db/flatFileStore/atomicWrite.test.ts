import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {atomicWrite, padSlot} from "../../../../src/db/flatFileStore/atomicWrite.js";

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

    expect(await fs.promises.readdir(path.dirname(target))).toEqual([path.basename(target)]);
  });

  it("should overwrite existing file", async () => {
    const target = path.join(tmpDir, "test.ssz");
    await atomicWrite(target, new Uint8Array([1]));
    await atomicWrite(target, new Uint8Array([2, 3]));

    const result = await fs.promises.readFile(target);
    expect(new Uint8Array(result)).toEqual(new Uint8Array([2, 3]));
  });
});

describe("padSlot", () => {
  it("should pad to 12 digits", () => {
    expect(padSlot(0)).toBe("000000000000");
    expect(padSlot(1)).toBe("000000000001");
    expect(padSlot(123456789012)).toBe("123456789012");
  });
});
