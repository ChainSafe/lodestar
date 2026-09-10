import {rimraf} from "rimraf";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {createChainForkConfig} from "@lodestar/config";
import {config} from "@lodestar/config/default";
import {encodeKey} from "@lodestar/db";
import {LevelDbController} from "@lodestar/db/controller/level";
import {testLogger} from "@lodestar/logger/test-utils";
import {ssz} from "@lodestar/types";
import {intToBytes} from "@lodestar/utils";
import {BeaconDb} from "../../../../../src/db/beacon.js";
import {Bucket} from "../../../../../src/db/buckets.js";
import {BlockArchiveRepository} from "../../../../../src/db/repositories/index.js";

describe("block archive repository", () => {
  const migrationConfig = createChainForkConfig({FULU_FORK_EPOCH: 0});
  const testDir = "./.tmp_block_archive_unit_test";
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

  it.each(["put", "batchPut", "putBinary", "batchPutBinary", "batch", "batchBinary"] as const)(
    "should store block and all indexes with %s",
    async (method) => {
      const block = ssz.phase0.SignedBeaconBlock.defaultValue();
      block.message.slot = 10;
      block.message.parentRoot.fill(1);
      const root = ssz.phase0.BeaconBlock.hashTreeRoot(block.message);
      const bytes = ssz.phase0.SignedBeaconBlock.serialize(block);
      if (method === "put") await blockArchive.put(10, block);
      if (method === "batchPut") await blockArchive.batchPut([{key: 10, value: block}]);
      if (method === "putBinary") await blockArchive.putBinary(10, bytes);
      if (method === "batchPutBinary") {
        await blockArchive.batchPutBinary([
          {key: 10, value: bytes, slot: 10, blockRoot: root, parentRoot: block.message.parentRoot},
        ]);
      }
      if (method === "batch") await blockArchive.batch([{type: "put", key: 10, value: block}]);
      if (method === "batchBinary") await blockArchive.batchBinary([{type: "put", key: 10, value: bytes}]);

      expect(await blockArchive.getBinary(10)).toEqual(Buffer.from(bytes));
      expect(await blockArchive.getSlotByRoot(root)).toBe(10);
      expect(await blockArchive.getSlotByParentRoot(block.message.parentRoot)).toBe(10);
      expect(await db.get(encodeKey(Bucket.index_mainChain, 10))).toEqual(Buffer.from(root));
    }
  );

  it.each(["delete", "batchDelete", "remove", "batchRemove", "batch", "batchBinary"] as const)(
    "should remove the slot index with %s",
    async (method) => {
      const block = ssz.phase0.SignedBeaconBlock.defaultValue();
      block.message.slot = 10;
      await blockArchive.put(10, block);
      const indexKey = encodeKey(Bucket.index_mainChain, 10);
      await db.put(indexKey, ssz.phase0.BeaconBlock.hashTreeRoot(block.message));
      if (method === "delete") await blockArchive.delete(10);
      if (method === "batchDelete") await blockArchive.batchDelete([10]);
      if (method === "remove") await blockArchive.remove(block);
      if (method === "batchRemove") await blockArchive.batchRemove([block]);
      if (method === "batch") await blockArchive.batch([{type: "del", key: 10}]);
      if (method === "batchBinary") await blockArchive.batchBinary([{type: "del", key: 10}]);
      expect(await blockArchive.get(10)).toBeNull();
      expect(await db.get(indexKey)).toBeNull();
    }
  );

  it("should not persist a block when its indexed batch fails", async () => {
    const block = ssz.phase0.SignedBeaconBlock.defaultValue();
    const error = Object.assign(new Error("write failed"), {code: "EIO"});
    vi.spyOn(db, "batchPut").mockRejectedValueOnce(error);
    await expect(blockArchive.put(0, block)).rejects.toThrow(error);
    expect(await blockArchive.get(0)).toBeNull();
    expect(await db.get(encodeKey(Bucket.index_mainChain, 0))).toBeNull();
  });

  it("should build the index from archived blocks despite missing or stale legacy indexes", async () => {
    blockArchive = new BlockArchiveRepository(migrationConfig, db);
    const blocks = [0, 10, 20].map((slot) => {
      const block = ssz.fulu.SignedBeaconBlock.defaultValue();
      block.message.slot = slot;
      return block;
    });
    for (const block of blocks) {
      await db.put(blockArchive.encodeKey(block.message.slot), blockArchive.encodeValue(block));
    }
    const roots = blocks.map((block) => ssz.fulu.BeaconBlock.hashTreeRoot(block.message));
    await db.put(encodeKey(Bucket.index_blockArchiveRootIndex, roots[0]), intToBytes(0, 8, "be"));
    await db.put(encodeKey(Bucket.index_blockArchiveRootIndex, roots[2]), intToBytes(20, 8, "be"));
    await db.put(encodeKey(Bucket.index_blockArchiveRootIndex, new Uint8Array(32).fill(1)), intToBytes(20, 8, "be"));
    await db.put(encodeKey(Bucket.index_blockArchiveRootIndex, new Uint8Array(32).fill(2)), intToBytes(30, 8, "be"));
    await db.put(encodeKey(Bucket.index_blockArchiveRootIndex, new Uint8Array(32).fill(3)), intToBytes(10, 8, "be"));
    await db.put(encodeKey(Bucket.index_mainChain, 40), new Uint8Array(32).fill(4));
    await blockArchive.init(testLogger());
    for (let i = 0; i < blocks.length; i++) {
      expect(
        await blockArchive.getRootBySlot(blocks[i].message.slot),
        `wrong root for slot ${blocks[i].message.slot}`
      ).toEqual(Buffer.from(roots[i]));
    }
    expect(await blockArchive.getRootBySlot(30)).toBeNull();
    expect(await blockArchive.getRootBySlot(40)).toBeNull();
    expect(await blockArchive.getRootBySlot(1)).toBeNull();

    const scan = vi.spyOn(db, "entriesStream");
    await blockArchive.init(testLogger());
    expect(scan).not.toHaveBeenCalled();
  });

  it("should retry an interrupted index build on restart", async () => {
    blockArchive = new BlockArchiveRepository(migrationConfig, db);
    const block = ssz.fulu.SignedBeaconBlock.defaultValue();
    await db.put(blockArchive.encodeKey(0), blockArchive.encodeValue(block));
    const error = Object.assign(new Error("write failed"), {code: "EIO"});
    vi.spyOn(db, "batch").mockRejectedValueOnce(error);
    await expect(blockArchive.init(testLogger())).rejects.toThrow(error);
    await db.close();
    db = await LevelDbController.create({name: testDir}, {logger: testLogger()});
    blockArchive = new BlockArchiveRepository(migrationConfig, db);
    await blockArchive.init(testLogger());
    expect(await blockArchive.getRootBySlot(0)).toEqual(Buffer.from(ssz.fulu.BeaconBlock.hashTreeRoot(block.message)));
  });

  it("should resume a partially persisted index build after reopening the database", async () => {
    blockArchive = new BlockArchiveRepository(migrationConfig, db);
    const blocks = Array.from({length: 1001}, (_, slot) => {
      const block = ssz.fulu.SignedBeaconBlock.defaultValue();
      block.message.slot = slot;
      return block;
    });
    await db.batchPut(
      blocks.map((block) => ({key: blockArchive.encodeKey(block.message.slot), value: blockArchive.encodeValue(block)}))
    );
    const writeBatch = db.batch.bind(db);
    const error = Object.assign(new Error("write failed"), {code: "EIO"});
    vi.spyOn(db, "batch").mockImplementationOnce(writeBatch).mockRejectedValueOnce(error);
    await expect(blockArchive.init(testLogger())).rejects.toThrow(error);
    expect(await blockArchive.getRootBySlot(0)).not.toBeNull();
    expect(await blockArchive.getRootBySlot(1000)).toBeNull();
    await db.close();
    db = await LevelDbController.create({name: testDir}, {logger: testLogger()});
    blockArchive = new BlockArchiveRepository(migrationConfig, db);
    const decode = vi.spyOn(blockArchive, "decodeValue");
    await blockArchive.init(testLogger());
    expect(decode).toHaveBeenCalledTimes(1);
    expect(await blockArchive.getRootBySlot(1000)).toEqual(
      Buffer.from(ssz.fulu.BeaconBlock.hashTreeRoot(blocks[1000].message))
    );
  });

  it("should finish indexing existing blocks before BeaconDb initialization returns", async () => {
    blockArchive = new BlockArchiveRepository(migrationConfig, db);
    const block = ssz.fulu.SignedBeaconBlock.defaultValue();
    await db.put(blockArchive.encodeKey(0), blockArchive.encodeValue(block));
    const beaconDb = new BeaconDb(migrationConfig, db, {
      dataColumnDir: `${testDir}/data_columns`,
      logger: testLogger(),
    });
    await beaconDb.init();
    expect(await beaconDb.blockArchive.getRootBySlot(0)).toEqual(
      Buffer.from(ssz.fulu.BeaconBlock.hashTreeRoot(block.message))
    );
  });

  it("should leave pre-Fulu history out of the startup scan", async () => {
    const block = ssz.phase0.SignedBeaconBlock.defaultValue();
    await db.put(blockArchive.encodeKey(0), blockArchive.encodeValue(block));
    const decode = vi.spyOn(blockArchive, "decodeValue");
    await blockArchive.init(testLogger());
    expect(decode).not.toHaveBeenCalled();
    expect(await blockArchive.getRootBySlot(0)).toBeNull();
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
