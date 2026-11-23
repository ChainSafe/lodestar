import fs from "node:fs";
import path from "node:path";
import tmp from "tmp";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {fromHex, toHex} from "@lodestar/utils";
import {fetchDevnetXmssTrees} from "../../../../src/cmds/validator/signers/xmssCache.js";

const RECORD_SIZE = 14696;

describe("fetchDevnetXmssTrees", () => {
  let tmpDir: tmp.DirResult;

  beforeEach(() => {
    tmpDir = tmp.dirSync({unsafeCleanup: true});
  });

  afterEach(() => {
    tmpDir.removeCallback();
  });

  it("reads the records of devnet keys, found by their public parameters", async () => {
    const file = path.join(tmpDir.name, "trees.xmss");
    fs.writeFileSync(file, Buffer.concat([0, 1, 2, 3].map((index) => Buffer.alloc(RECORD_SIZE, index))));
    const logger = {warn: vi.fn()};

    // The devnet mnemonic's keys 2 and 3, and a key that is not of the devnet
    const publicKeys = [
      fromHex("0x9fdea071c029316bd6d677e83cf393af28dec171ddcc42b9fbcbaa3d6d1bb428"),
      fromHex("0xff5253ca9999583977b32bbc8804bf696280f80785ba6f5b12e5716b9cd84cf5"),
    ];
    const trees = await fetchDevnetXmssTrees(
      file,
      [publicKeys[1].subarray(16), new Uint8Array(16), publicKeys[0].subarray(16)],
      logger
    );

    expect(trees.size).toBe(2);
    for (const [i, publicKey] of publicKeys.entries()) {
      const found = trees.get(toHex(publicKey.subarray(16)));
      expect(found && Buffer.from(found.publicKey)).toEqual(Buffer.from(publicKey));
      expect(found && Buffer.from(found.trees)).toEqual(Buffer.alloc(RECORD_SIZE, i + 2));
    }
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("leaves keys whose records cannot be read to be built", async () => {
    const logger = {warn: vi.fn()};
    const publicKey = fromHex("0x9fdea071c029316bd6d677e83cf393af28dec171ddcc42b9fbcbaa3d6d1bb428");
    const file = path.join(tmpDir.name, "short.xmss");
    fs.writeFileSync(file, Buffer.alloc(RECORD_SIZE));
    const trees = await fetchDevnetXmssTrees(file, [publicKey.subarray(16)], logger);
    expect(trees.size).toBe(0);
    expect(logger.warn).toHaveBeenCalledOnce();
  }, 20_000);
});
