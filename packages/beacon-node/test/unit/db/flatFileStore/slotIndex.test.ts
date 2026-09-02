import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {SlotIndex} from "../../../../src/db/flatFileStore/slotIndex.js";

describe("SlotIndex", () => {
  let tmpDir: string | undefined;

  afterEach(async () => {
    if (tmpDir) await fs.promises.rm(tmpDir, {recursive: true, force: true});
  });

  it("should add, deduplicate, and remove slots", () => {
    const index = new SlotIndex();

    index.add(100);
    index.add(100);
    index.add(200);
    expect(index.getBefore(200)).toEqual([100]);

    index.remove(100);
    expect(index.getBefore(201)).toEqual([200]);
  });

  it("should rebuild from canonical top-level directories", async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "lodestar-slot-index-"));
    await fs.promises.mkdir(path.join(tmpDir, "000000000100"));
    await fs.promises.mkdir(path.join(tmpDir, "100"));
    await fs.promises.writeFile(path.join(tmpDir, "000000000200"), new Uint8Array());

    const index = new SlotIndex();
    const stats = await index.rebuildFromDisk(tmpDir);

    expect(stats).toEqual({slots: 1, ignoredEntries: 2});
    expect(index.getBefore(101)).toEqual([100]);
  });
});
