import fs from "node:fs";
import {open} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {atomicWrite} from "../../../../src/db/flatFileStore/atomicWrite.js";
import {assertValidRootHex, isValidRootHex, padSlot} from "../../../../src/db/flatFileStore/path.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {...actual, open: vi.fn(actual.open)};
});

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

  it("should sync the parent after creating the target directory", async () => {
    const target = path.join(tmpDir, "slot", "test.ssz");
    vi.mocked(open).mockClear();

    await atomicWrite(target, new Uint8Array([1]));

    expect(open).toHaveBeenCalledWith(tmpDir, "r");
  });

  it("should retry a failed parent directory sync", async () => {
    const target = path.join(tmpDir, "slot", "test.ssz");
    vi.mocked(open).mockClear();
    vi.mocked(open).mockRejectedValueOnce(new Error("sync failed"));

    await expect(atomicWrite(target, new Uint8Array([1]))).rejects.toThrow("sync failed");
    await atomicWrite(target, new Uint8Array([1]));

    expect(open).toHaveBeenNthCalledWith(1, tmpDir, "r");
    expect(open).toHaveBeenNthCalledWith(2, tmpDir, "r");
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

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    "should reject invalid slot %s",
    (slot) => {
      expect(() => padSlot(slot)).toThrow("Invalid flat file slot");
    }
  );
});

describe("root validation", () => {
  const validRoot = `0x${"ab".repeat(32)}`;

  it("should accept an exact lowercase 32-byte root", () => {
    expect(isValidRootHex(validRoot)).toBe(true);
    expect(() => assertValidRootHex(validRoot)).not.toThrow();
  });

  it.each(["../escape", `0x${"ab".repeat(31)}`, `0x${"ab".repeat(33)}`, `0x${"AB".repeat(32)}`, "ab".repeat(32)])(
    "should reject invalid root %s",
    (rootHex) => {
      expect(isValidRootHex(rootHex)).toBe(false);
      expect(() => assertValidRootHex(rootHex)).toThrow("Invalid flat file root");
    }
  );
});
