import fs from "node:fs";
import path from "node:path";
import tmp from "tmp";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {toHex} from "@lodestar/utils";
import {fetchXmssTrees} from "../../../../src/cmds/validator/signers/xmssCache.js";

const RECORD_SIZE = 14696;

describe("fetchXmssTrees", () => {
  let tmpDir: tmp.DirResult;
  // The validators' public keys, by index. The last two share a public parameter.
  const registry = [0, 1, 2, 3, 4, 4].map((byte, index) => {
    const publicKey = new Uint8Array(32).fill(byte + 1, 16);
    publicKey[0] = index;
    return publicKey;
  });
  const parameterOf = (index: number): Uint8Array => registry[index].subarray(16);

  beforeEach(() => {
    tmpDir = tmp.dirSync({unsafeCleanup: true});
  });

  afterEach(() => {
    tmpDir.removeCallback();
  });

  it("reads the records of validators, found by their public parameters", async () => {
    const file = path.join(tmpDir.name, "trees.xmss");
    fs.writeFileSync(file, Buffer.concat(registry.map((_, index) => Buffer.alloc(RECORD_SIZE, index))));
    const logger = {warn: vi.fn()};

    // Validators 3 and 2, a key that is no validator's, and one whose public parameter two share
    const trees = await fetchXmssTrees(
      file,
      [parameterOf(3), new Uint8Array(16), parameterOf(2), parameterOf(4)],
      registry,
      logger
    );

    expect(trees.size).toBe(2);
    for (const index of [2, 3]) {
      const found = trees.get(toHex(parameterOf(index)));
      expect(found && Buffer.from(found.publicKey)).toEqual(Buffer.from(registry[index]));
      expect(found && Buffer.from(found.trees)).toEqual(Buffer.alloc(RECORD_SIZE, index));
    }
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("leaves keys whose records cannot be read to be built", async () => {
    const logger = {warn: vi.fn()};
    const file = path.join(tmpDir.name, "short.xmss");
    fs.writeFileSync(file, Buffer.alloc(RECORD_SIZE));
    const trees = await fetchXmssTrees(file, [parameterOf(2)], registry, logger);
    expect(trees.size).toBe(0);
    expect(logger.warn).toHaveBeenCalledOnce();
  });
});
