import {rimraf} from "rimraf";
import {describe, it, expect, beforeEach, afterEach, vi} from "vitest";
import {ssz} from "@lodestar/types";
import {config} from "@lodestar/config/default";
import {intToBytes} from "@lodestar/utils";
import {LevelDbController, encodeKey} from "@lodestar/db";

import {BlockArchiveRepository} from "../../../../../src/db/repositories/index.js";
import {testLogger} from "../../../../utils/logger.js";
import {Bucket} from "../../../../../src/db/buckets.js";

describe("block archive repository", () => {
  const testDir = "./.tmp";
  let blockArchive: BlockArchiveRepository;
  let db: LevelDbController;

  beforeEach(async () => {
    db = await LevelDbController.create({name: testDir}, {logger: testLogger()});
    blockArchive = new BlockArchiveRepository(config, db);
  });
  afterEach(async () => {
    await db.close();
    rimraf.sync(testDir);
  });

  it("should retrieve blocks in order", async () => {
    await blockArchive.batchPut(
      Array.from({length: 1001}, (_, i) => {
        const slot = i;
        const block = ssz.phase0.SignedBeaconBlock.defaultValue();
        block.message.slot = slot;
        return {
          key: slot,
          value: block,
        };
      })
    );
    // test keys
    let lastSlot = 0;
    for await (const slot of blockArchive.keysStream()) {
      expect(slot).toBeGreaterThanOrEqual(lastSlot);
      lastSlot = slot;
    }

    // test values
    lastSlot = 0;
    for await (const block of blockArchive.valuesStream()) {
      expect(block.message.slot).toBeGreaterThanOrEqual(lastSlot);
      lastSlot = block.message.slot;
    }

    let blocks;
    // test gte, lte
    blocks = await blockArchive.values({gte: 2, lte: 5});
    expect(blocks.length).toBe(4);
    expect(blocks[0].message.slot).toBe(2);
    expect(blocks[3].message.slot).toBe(5);
    lastSlot = 0;
    for (const block of blocks) {
      expect(block.message.slot).toBeGreaterThan(lastSlot);
      lastSlot = block.message.slot;
    }

    // test gt, lt
    blocks = await blockArchive.values({gt: 2, lt: 6});
    expect(blocks.length).toBe(3);
    expect(blocks[0].message.slot).toBe(3);
    expect(blocks[2].message.slot).toBe(5);
    lastSlot = 0;
    for (const block of blocks) {
      expect(block.message.slot).toBeGreaterThan(lastSlot);
      lastSlot = block.message.slot;
    }

    // test across byte boundaries
    blocks = await blockArchive.values({gte: 200, lt: 400});
    expect(blocks.length).toBe(200);
    expect(blocks[0].message.slot).toBe(200);
    expect(blocks[199].message.slot).toBe(399);
    lastSlot = 0;
    for (const block of blocks) {
      expect(block.message.slot).toBeGreaterThan(lastSlot);
      lastSlot = block.message.slot;
    }

    // test gt until end
    blocks = await blockArchive.values({gt: 700});
    expect(blocks.length).toBe(300);
    expect(blocks[0].message.slot).toBe(701);
    expect(blocks[299].message.slot).toBe(1000);
    lastSlot = 0;
    for (const block of blocks) {
      expect(block.message.slot).toBeGreaterThan(lastSlot);
      lastSlot = block.message.slot;
    }

    // test beginning until lt
    blocks = await blockArchive.values({lte: 200});
    expect(blocks.length).toBe(201);
    expect(blocks[0].message.slot).toBe(0);
    expect(blocks[200].message.slot).toBe(200);
    lastSlot = 0;
    for (const block of blocks) {
      expect(block.message.slot).toBeGreaterThanOrEqual(lastSlot);
      lastSlot = block.message.slot;
    }
  });

  it("should store indexes when adding single block", async () => {
    const spy = vi.spyOn(db, "put");
    const block = ssz.phase0.SignedBeaconBlock.defaultValue();
    await blockArchive.add(block);
    expect(spy).toHaveBeenCalledWith(
      encodeKey(Bucket.index_blockArchiveRootIndex, ssz.phase0.BeaconBlock.hashTreeRoot(block.message)),
      intToBytes(block.message.slot, 8, "be")
    );
    expect(spy).toHaveBeenCalledWith(
      encodeKey(Bucket.index_blockArchiveParentRootIndex, block.message.parentRoot),
      intToBytes(block.message.slot, 8, "be")
    );
  });

  it("should store indexes when block batch", async () => {
    const spy = vi.spyOn(db, "put");
    const blocks = [ssz.phase0.SignedBeaconBlock.defaultValue(), ssz.phase0.SignedBeaconBlock.defaultValue()];
    await blockArchive.batchAdd(blocks);

    // TODO: Need to improve these assertions
    expect(spy.mock.calls).toStrictEqual(
      expect.arrayContaining([
        [
          encodeKey(Bucket.index_blockArchiveRootIndex, ssz.phase0.BeaconBlock.hashTreeRoot(blocks[0].message)),
          intToBytes(blocks[0].message.slot, 8, "be"),
        ],
        [
          encodeKey(Bucket.index_blockArchiveRootIndex, ssz.phase0.BeaconBlock.hashTreeRoot(blocks[0].message)),
          intToBytes(blocks[0].message.slot, 8, "be"),
        ],
      ])
    );
    expect(spy.mock.calls).toStrictEqual(
      expect.arrayContaining([
        [
          encodeKey(Bucket.index_blockArchiveParentRootIndex, blocks[0].message.parentRoot),
          intToBytes(blocks[0].message.slot, 8, "be"),
        ],
        [
          encodeKey(Bucket.index_blockArchiveParentRootIndex, blocks[0].message.parentRoot),
          intToBytes(blocks[0].message.slot, 8, "be"),
        ],
      ])
    );
  });

  it("should get slot by root", async () => {
    const block = ssz.phase0.SignedBeaconBlock.defaultValue();
    await blockArchive.add(block);
    const slot = await blockArchive.getSlotByRoot(ssz.phase0.BeaconBlock.hashTreeRoot(block.message));
    expect(slot).toBe(block.message.slot);
  });

  it("should get block by root", async () => {
    const block = ssz.phase0.SignedBeaconBlock.defaultValue();
    await blockArchive.add(block);
    const retrieved = await blockArchive.getByRoot(ssz.phase0.BeaconBlock.hashTreeRoot(block.message));
    if (!retrieved) throw Error("getByRoot returned null");
    expect(ssz.phase0.SignedBeaconBlock.equals(retrieved, block)).toBe(true);
  });

  it("should get slot by parent root", async () => {
    const block = ssz.phase0.SignedBeaconBlock.defaultValue();
    await blockArchive.add(block);
    const slot = await blockArchive.getSlotByParentRoot(block.message.parentRoot);
    expect(slot).toBe(block.message.slot);
  });

  it("should get block by parent root", async () => {
    const block = ssz.phase0.SignedBeaconBlock.defaultValue();
    await blockArchive.add(block);
    const retrieved = await blockArchive.getByParentRoot(block.message.parentRoot);
    if (!retrieved) throw Error("getByRoot returned null");
    expect(ssz.phase0.SignedBeaconBlock.equals(retrieved, block)).toBe(true);
  });
});
