import fs from "node:fs";
import path from "node:path";
import tmp from "tmp";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {fromHex} from "@lodestar/utils";
import {devnetXmssTreeSource} from "../../../../src/cmds/validator/signers/xmssCache.js";

const RECORD_SIZE = 14696;

describe("devnetXmssTreeSource", () => {
  let tmpDir: tmp.DirResult;

  beforeEach(() => {
    tmpDir = tmp.dirSync({unsafeCleanup: true});
  });

  afterEach(() => {
    tmpDir.removeCallback();
  });

  it("reads the record of a devnet key, found by its public parameter", async () => {
    const file = path.join(tmpDir.name, "trees.xmss");
    fs.writeFileSync(file, Buffer.concat([0, 1, 2].map((index) => Buffer.alloc(RECORD_SIZE, index))));
    const logger = {warn: vi.fn()};
    const source = devnetXmssTreeSource(file, logger);

    // The devnet mnemonic's key 2
    const publicKey = fromHex("0x9fdea071c029316bd6d677e83cf393af28dec171ddcc42b9fbcbaa3d6d1bb428");
    const found = await source(publicKey.subarray(16));
    expect(found && Buffer.from(found.publicKey)).toEqual(Buffer.from(publicKey));
    expect(found && Buffer.from(found.trees)).toEqual(Buffer.alloc(RECORD_SIZE, 2));

    expect(await source(new Uint8Array(16))).toBeNull();
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
