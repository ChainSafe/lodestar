import {mkdtemp, rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {createChainForkConfig} from "@lodestar/config";
import {encodeKey} from "@lodestar/db";
import {LevelDbController} from "@lodestar/db/controller/level";
import type {IForkChoice} from "@lodestar/fork-choice";
import {testLogger} from "@lodestar/logger/test-utils";
import {NUMBER_OF_COLUMNS} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {defer, toRootHex} from "@lodestar/utils";
import {archiveBlocks} from "../../../src/chain/archiveStore/utils/archiveBlocks.js";
import {BeaconEngineCore} from "../../../src/chain/beaconEngine/beaconEngineCore.js";
import {IBeaconEngine} from "../../../src/chain/interface.js";
import {BeaconDb} from "../../../src/db/beacon.js";
import {Bucket} from "../../../src/db/buckets.js";
import {blobSidecarsWrapperSsz} from "../../../src/db/repositories/blobSidecars.js";
import {generateProtoBlock} from "../../utils/typeGenerator.js";

describe("BeaconDb.pruneHotDb", () => {
  const config = createChainForkConfig({FULU_FORK_EPOCH: 0});
  const logger = testLogger();
  let tmpDir: string;
  let db: BeaconDb;
  let controller: LevelDbController;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "lodestar-prune-hot-db-"));
    controller = await LevelDbController.create({name: path.join(tmpDir, "leveldb")}, {logger});
    db = new BeaconDb(config, controller, {dataColumnDir: path.join(tmpDir, "data_columns"), logger});
    await db.init();
  });

  afterEach(async () => {
    await db.close();
    await rm(tmpDir, {recursive: true, force: true});
  });

  it.each([0, 1, 8])("prunes hot sidecars for %i roots while preserving other data", async (rootCount) => {
    const columns = Array.from({length: NUMBER_OF_COLUMNS}, (_, index) => ({
      ...ssz.fulu.DataColumnSidecar.defaultValue(),
      index,
    }));
    for (let i = 0; i < rootCount; i++) {
      const root = Buffer.alloc(32, i);
      await db.dataColumnSidecar.putMany(root, columns);
      await db.blobSidecars.put(root, {blockRoot: root, slot: i, blobSidecars: []});
    }

    const block = ssz.fulu.SignedBeaconBlock.defaultValue();
    const root = ssz.fulu.BeaconBlock.hashTreeRoot(block.message);
    const slot = block.message.slot;
    const blobSidecars = {blockRoot: root, slot, blobSidecars: [ssz.deneb.BlobSidecar.defaultValue()]};
    const column = columns[0];
    await db.block.put(root, block);
    await db.blobSidecarsArchive.put(slot, blobSidecars);
    await db.dataColumnSidecarArchive.put(slot, column);
    await db.dataColumns.putManyBinary({slot, blockRoot: toRootHex(root)}, [
      {index: column.index, data: ssz.fulu.DataColumnSidecar.serialize(column)},
    ]);
    expect(await db.dataColumnSidecar.keys()).toHaveLength(rootCount * NUMBER_OF_COLUMNS);

    const batchDelete = vi.spyOn(controller, "batchDelete");
    const compactRange = controller.compactRange.bind(controller);
    const compact = vi.spyOn(controller, "compactRange").mockImplementation(async (start, end) => {
      expect(batchDelete.mock.settledResults.every(({type}) => type === "fulfilled")).toBe(true);
      expect(await db.dataColumnSidecar.keys()).toHaveLength(0);
      await compactRange(start, end);
    });

    await db.pruneHotDb();

    expect(compact).toHaveBeenCalledExactlyOnceWith(
      encodeKey(Bucket.allForks_dataColumnSidecars, Buffer.alloc(0)),
      encodeKey(Bucket.allForks_dataColumnSidecars + 1, Buffer.alloc(0))
    );
    for (const deleteOrder of batchDelete.mock.invocationCallOrder) {
      expect(deleteOrder).toBeLessThan(compact.mock.invocationCallOrder[0]);
    }

    expect((await db.dataColumnSidecar.keys()).length).toBe(0);
    expect((await db.blobSidecars.keys()).length).toBe(0);
    expect(await db.block.getBinary(root)).toEqual(Buffer.from(ssz.fulu.SignedBeaconBlock.serialize(block)));
    expect(await db.blobSidecarsArchive.getBinary(slot)).toEqual(
      Buffer.from(blobSidecarsWrapperSsz.serialize(blobSidecars))
    );
    expect(await db.dataColumnSidecarArchive.getBinary(slot, column.index)).toEqual(
      Buffer.from(ssz.fulu.DataColumnSidecar.serialize(column))
    );
    expect(await db.dataColumns.getAll({slot, blockRoot: toRootHex(root)})).toEqual([column]);
  });

  it("compacts legacy columns already deleted by an earlier startup", async () => {
    const root = Buffer.alloc(32, 1);
    await db.dataColumnSidecar.putMany(root, [ssz.fulu.DataColumnSidecar.defaultValue()]);
    await db.dataColumnSidecar.deleteMany([root]);
    expect(await db.dataColumnSidecar.keys()).toHaveLength(0);
    const compact = vi.spyOn(controller, "compactRange");

    await db.pruneHotDb();

    expect(compact).toHaveBeenCalledExactlyOnceWith(
      encodeKey(Bucket.allForks_dataColumnSidecars, Buffer.alloc(0)),
      encodeKey(Bucket.allForks_dataColumnSidecars + 1, Buffer.alloc(0))
    );
  });

  it("waits for legacy column compaction to complete", async () => {
    const started = defer<void>();
    const completed = defer<void>();
    const compactRange = controller.compactRange.bind(controller);
    const compact = vi.spyOn(controller, "compactRange").mockImplementation(async (start, end) => {
      started.resolve();
      await completed.promise;
      await compactRange(start, end);
    });
    let pruned = false;
    const pruning = db.pruneHotDb().then(() => {
      pruned = true;
    });

    try {
      await Promise.race([started.promise, pruning]);
      expect(compact).toHaveBeenCalledTimes(1);
      expect(pruned).toBe(false);
    } finally {
      completed.resolve();
      await pruning;
    }
  });

  it("keeps canonical flat columns serveable after block archiving", async () => {
    const block = ssz.fulu.SignedBeaconBlock.defaultValue();
    const slot = block.message.slot;
    const root = ssz.fulu.BeaconBlock.hashTreeRoot(block.message);
    const blockRoot = toRootHex(root);
    const key = {slot, blockRoot};
    const column = ssz.fulu.DataColumnSidecar.defaultValue();
    const columnBytes = ssz.fulu.DataColumnSidecar.serialize(column);
    await db.block.put(root, block);
    await db.dataColumns.putManyBinary(key, [{index: column.index, data: columnBytes}]);
    const forkChoice = {
      getAllAncestorAndNonAncestorBlocksDefaultStatus: () => ({
        ancestors: [generateProtoBlock({slot, blockRoot})],
        nonAncestors: [],
      }),
    } as unknown as IForkChoice;

    const engineContext = {
      config,
      db,
      forkChoice,
      logger,
      clock: {currentEpoch: 0, currentSlot: 0},
    } as unknown as BeaconEngineCore;
    Object.assign(forkChoice, {
      getFinalizedCheckpoint: () => ({epoch: 0, root, rootHex: blockRoot}),
      getHead: () => generateProtoBlock({slot, blockRoot}),
    });
    const engine = {
      migrateCanonicalBlocks: BeaconEngineCore.prototype.migrateCanonicalBlocks.bind(engineContext),
      pruneLightClientNonCheckpointData: vi.fn(),
    } as unknown as IBeaconEngine;
    await archiveBlocks(
      config,
      db,
      engine,
      {canonical: [generateProtoBlock({slot, blockRoot})], nonCanonical: []},
      logger,
      {epoch: 0, root, rootHex: blockRoot},
      0
    );

    expect(await db.block.getBinary(root)).toBeNull();
    expect(await db.blockArchive.getBinary(slot)).toEqual(Buffer.from(ssz.fulu.SignedBeaconBlock.serialize(block)));
    expect(await db.dataColumns.getManyBinary(key, [column.index])).toEqual([columnBytes]);
  });
});

describe("archive repositories pruneBefore", () => {
  const config = createChainForkConfig({FULU_FORK_EPOCH: 0});
  const logger = testLogger();
  let tmpDir: string;
  let db: BeaconDb;
  let controller: LevelDbController;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "lodestar-archive-prune-"));
    controller = await LevelDbController.create({name: path.join(tmpDir, "leveldb")}, {logger});
    db = new BeaconDb(config, controller, {dataColumnDir: path.join(tmpDir, "data_columns"), logger});
    await db.init();
  });

  afterEach(async () => {
    await db.close();
    await rm(tmpDir, {recursive: true, force: true});
  });

  it("prunes legacy data columns from where the previous prune ended", async () => {
    for (const slot of [1, 2, 3, 4, 5]) {
      for (const index of [0, 1]) {
        await db.dataColumnSidecarArchive.put(slot, {...ssz.fulu.DataColumnSidecar.defaultValue(), index});
      }
    }
    const compactRange = vi.spyOn(controller, "compactRange");
    const keys = vi.spyOn(db.dataColumnSidecarArchive, "keys");

    await expect(db.dataColumnSidecarArchive.pruneBefore(3)).resolves.toEqual([1, 2]);
    await expect(db.dataColumnSidecarArchive.pruneBefore(2)).resolves.toEqual([]);
    await expect(db.dataColumnSidecarArchive.pruneBefore(5)).resolves.toEqual([3, 4]);

    expect(compactRange).toHaveBeenCalledOnce();
    expect(compactRange).toHaveBeenCalledWith(
      encodeKey(Bucket.allForks_dataColumnSidecarsArchive, db.dataColumnSidecarArchive.getMinKeyRaw(0)),
      encodeKey(Bucket.allForks_dataColumnSidecarsArchive, db.dataColumnSidecarArchive.getMinKeyRaw(3))
    );
    expect(keys.mock.calls).toEqual([
      [{gte: {prefix: 0, id: 0}, lt: {prefix: 3, id: 0}}],
      [{gte: {prefix: 3, id: 0}, lt: {prefix: 5, id: 0}}],
    ]);
    expect(await db.dataColumnSidecarArchive.keys()).toEqual([
      {prefix: 5, id: 0},
      {prefix: 5, id: 1},
    ]);
  });
});

describe("BeaconDb.compactLegacyDataColumns", () => {
  const config = createChainForkConfig({FULU_FORK_EPOCH: 0});
  const logger = testLogger();
  const start = encodeKey(Bucket.allForks_dataColumnSidecars, Buffer.alloc(0));
  const columns = Array.from({length: NUMBER_OF_COLUMNS}, (_, index) => ({
    ...ssz.fulu.DataColumnSidecar.defaultValue(),
    index,
  }));
  const roots = Array.from({length: 8}, (_, i) => Buffer.alloc(32, i));
  let tmpDir: string;
  let db: BeaconDb;
  let controller: LevelDbController;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "lodestar-compact-legacy-columns-"));
    controller = await LevelDbController.create({name: path.join(tmpDir, "leveldb")}, {logger});
    db = new BeaconDb(config, controller, {dataColumnDir: path.join(tmpDir, "data_columns"), logger});
    await db.init();
    for (const root of roots) await db.dataColumnSidecar.putMany(root, columns);
    for (let slot = 1; slot <= 8; slot++) await db.dataColumnSidecarArchive.putMany(slot, columns);
    await controller.compactRange(start, encodeKey(Bucket.allForks_dataColumnSidecarsArchive + 1, Buffer.alloc(0)));
  });

  afterEach(async () => {
    await db.close();
    await rm(tmpDir, {recursive: true, force: true});
  });

  function prunedEnd(slot: number): Uint8Array {
    return encodeKey(Bucket.allForks_dataColumnSidecarsArchive, db.dataColumnSidecarArchive.getMinKeyRaw(slot));
  }

  it("rewrites legacy columns deleted while a snapshot was held", async () => {
    // An open iterator holds a snapshot, so compaction keeps the deleted entries in the bottom level
    const iterator = controller.keysStream()[Symbol.asyncIterator]();
    await iterator.next();
    await db.dataColumnSidecar.deleteMany(roots);
    await db.dataColumnSidecarArchive.deleteMany([1, 2, 3, 4, 5]);
    await controller.compactRange(start, prunedEnd(6));
    await iterator.return?.();
    await controller.compactRange(start, prunedEnd(6));
    const sizeBefore = await controller.approximateSize(start, prunedEnd(6));
    expect(sizeBefore).toBeGreaterThan(0);

    await db.compactLegacyDataColumns(6, 0);

    expect(await controller.approximateSize(start, prunedEnd(6))).toBeLessThan(sizeBefore / 10);
    expect(await controller.keys({gte: start, lt: prunedEnd(6)})).toEqual([]);
    expect(new Set((await db.dataColumnSidecarArchive.keys()).map(({prefix}) => prefix))).toEqual(new Set([6, 7, 8]));
    expect(await db.dataColumnSidecarArchive.keys()).toHaveLength(3 * NUMBER_OF_COLUMNS);
  });

  it("skips the rewrite while the range is below the threshold", async () => {
    const batchPut = vi.spyOn(controller, "batchPut");
    const compactRange = vi.spyOn(controller, "compactRange");

    await db.compactLegacyDataColumns(6);

    expect(batchPut).not.toHaveBeenCalled();
    expect(compactRange).not.toHaveBeenCalled();
  });
});
