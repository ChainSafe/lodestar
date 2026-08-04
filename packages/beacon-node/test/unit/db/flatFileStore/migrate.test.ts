import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {createChainForkConfig} from "@lodestar/config";
import {config as defaultConfig} from "@lodestar/config/default";
import {LevelDbController} from "@lodestar/db/controller/level";
import {LogLevel, testLogger} from "@lodestar/logger/test-utils";
import {NUMBER_OF_COLUMNS, SLOTS_PER_EPOCH} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {type Logger, toRootHex} from "@lodestar/utils";
import {BeaconDb} from "../../../../src/db/beacon.js";
import {migrateArchivedSidecars} from "../../../../src/db/flatFileStore/migrate.js";
import {
  BlobSidecarsArchiveRepository,
  BlobSidecarsRepository,
  DataColumnSidecarArchiveRepository,
  DataColumnSidecarRepository,
} from "../../../../src/db/repositories/index.js";
import {createMetricsTest} from "../../metrics/utils.js";

const config = createChainForkConfig({
  ...defaultConfig,
  FULU_FORK_EPOCH: 0,
  GLOAS_FORK_EPOCH: 1,
});
const silentLogger: Logger = {
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  verbose: vi.fn(),
  debug: vi.fn(),
};

describe("archived sidecar migration", () => {
  let tmpDir: string;
  let controller: LevelDbController;
  let db: BeaconDb;
  let blobSidecars: BlobSidecarsRepository;
  let blobSidecarsArchive: BlobSidecarsArchiveRepository;
  let dataColumnSidecar: DataColumnSidecarRepository;
  let dataColumnSidecarArchive: DataColumnSidecarArchiveRepository;

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "lodestar-flatfile-migration-"));
    controller = await LevelDbController.create({name: path.join(tmpDir, "chain-db")}, {logger: silentLogger});
    db = new BeaconDb(config, controller);
    blobSidecars = new BlobSidecarsRepository(config, controller);
    blobSidecarsArchive = new BlobSidecarsArchiveRepository(config, controller);
    dataColumnSidecar = new DataColumnSidecarRepository(config, controller);
    dataColumnSidecarArchive = new DataColumnSidecarArchiveRepository(config, controller);
  });

  afterEach(async () => {
    await db.close();
    await fs.promises.rm(tmpDir, {recursive: true, force: true});
  });

  it("moves archived sidecars to flat files and clears legacy hot sidecars", async () => {
    const archivedBlobSlot = 10;
    const archivedBlobRoot = new Uint8Array(32).fill(0xaa);
    await blobSidecarsArchive.add({
      blockRoot: archivedBlobRoot,
      slot: archivedBlobSlot,
      blobSidecars: [],
    });

    const archivedColumnSlot = 11;
    const archivedColumn = ssz.fulu.DataColumnSidecar.defaultValue();
    archivedColumn.index = 3;
    archivedColumn.signedBlockHeader.message.slot = archivedColumnSlot;
    const archivedColumnRoot = ssz.phase0.BeaconBlockHeader.hashTreeRoot(archivedColumn.signedBlockHeader.message);
    await dataColumnSidecarArchive.put(archivedColumnSlot, archivedColumn);
    const secondArchivedColumn = ssz.fulu.DataColumnSidecar.defaultValue();
    secondArchivedColumn.index = 4;
    secondArchivedColumn.signedBlockHeader.message.slot = archivedColumnSlot;
    await dataColumnSidecarArchive.put(archivedColumnSlot, secondArchivedColumn);

    const archivedGloasColumnSlot = SLOTS_PER_EPOCH;
    const archivedGloasColumnRoot = new Uint8Array(32).fill(0xab);
    const archivedGloasColumn = ssz.gloas.DataColumnSidecar.defaultValue();
    archivedGloasColumn.index = 6;
    archivedGloasColumn.slot = archivedGloasColumnSlot;
    archivedGloasColumn.beaconBlockRoot = archivedGloasColumnRoot;
    await dataColumnSidecarArchive.put(archivedGloasColumnSlot, archivedGloasColumn);

    const hotBlobSlot = 12;
    const hotBlobRoot = new Uint8Array(32).fill(0xbb);
    await blobSidecars.add({
      blockRoot: hotBlobRoot,
      slot: hotBlobSlot,
      blobSidecars: [],
    });

    const hotColumnSlot = 13;
    const hotColumnRoot = new Uint8Array(32).fill(0xcc);
    const hotColumn = ssz.fulu.DataColumnSidecar.defaultValue();
    hotColumn.index = 4;
    hotColumn.signedBlockHeader.message.slot = hotColumnSlot;
    await dataColumnSidecar.put(hotColumnRoot, hotColumn);

    const metrics = createMetricsTest();
    await db.initFlatFileStore(tmpDir, 0, testLogger("flat-file-migration"), metrics.flatFileStore);

    expect(await blobSidecarsArchive.get(archivedBlobSlot)).toBeNull();
    expect(await dataColumnSidecarArchive.values(archivedColumnSlot)).toEqual([]);
    expect(await dataColumnSidecarArchive.values(archivedGloasColumnSlot)).toEqual([]);

    const store = db.flatFileStore;
    expect(await store.getBlobSidecarsBinary(archivedBlobSlot, toRootHex(archivedBlobRoot))).not.toBeNull();
    expect(
      await store.getDataColumnsBinary(archivedColumnSlot, toRootHex(archivedColumnRoot), [
        archivedColumn.index,
        secondArchivedColumn.index,
      ])
    ).toEqual([
      ssz.fulu.DataColumnSidecar.serialize(archivedColumn),
      ssz.fulu.DataColumnSidecar.serialize(secondArchivedColumn),
    ]);
    expect(
      await store.getDataColumnsBinary(archivedGloasColumnSlot, toRootHex(archivedGloasColumnRoot), [
        archivedGloasColumn.index,
      ])
    ).toEqual([ssz.gloas.DataColumnSidecar.serialize(archivedGloasColumn)]);

    expect(await blobSidecars.get(hotBlobRoot)).not.toBeNull();
    expect(await dataColumnSidecar.values(hotColumnRoot)).toHaveLength(1);

    await db.pruneHotDb();

    expect(await blobSidecars.get(hotBlobRoot)).toBeNull();
    expect(await dataColumnSidecar.values(hotColumnRoot)).toEqual([]);
    expect(await store.getBlobSidecarsBinary(hotBlobSlot, toRootHex(hotBlobRoot))).toBeNull();
    expect(await store.getDataColumnsBinary(hotColumnSlot, toRootHex(hotColumnRoot), [hotColumn.index])).toEqual([
      undefined,
    ]);

    const migrationMetrics = await metrics.register.getSingleMetricAsString(
      "lodestar_flat_file_store_migration_writes_total"
    );
    expect(migrationMetrics).toContain(
      'lodestar_flat_file_store_migration_writes_total{store="blob",result="success"} 1'
    );
    expect(migrationMetrics).toContain(
      'lodestar_flat_file_store_migration_writes_total{store="column",result="success"} 2'
    );
  });

  it("rejects flat file access before initialization", () => {
    expect(() => db.flatFileStore).toThrow("Flat file store is not initialized");
  });

  it("logs migration phase progress during a long startup", async () => {
    const blobSlot = 29;
    await blobSidecarsArchive.add({
      blockRoot: new Uint8Array(32).fill(0xaa),
      slot: blobSlot,
      blobSidecars: [],
    });

    for (const slot of [30, 31]) {
      const column = ssz.fulu.DataColumnSidecar.defaultValue();
      column.index = 0;
      column.signedBlockHeader.message.slot = slot;
      await dataColumnSidecarArchive.put(slot, column);
    }

    const store = {
      putBlobSidecars: vi.fn().mockResolvedValue(undefined),
      putDataColumnsBinary: vi.fn().mockResolvedValue(undefined),
    };
    const logger = testLogger("flat-file-migration-progress");
    const infoSpy = vi.spyOn(logger, LogLevel.info).mockImplementation(() => {});
    let now = 0;
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => {
      now += 31_000;
      return now;
    });

    try {
      await migrateArchivedSidecars(config, blobSidecarsArchive, dataColumnSidecarArchive, store, controller, logger);
    } finally {
      nowSpy.mockRestore();
    }

    expect(infoSpy).toHaveBeenCalledWith(
      "Migrating archived blob sidecars to flat-file storage; startup will wait for completion",
      {startingSlot: blobSlot}
    );
    expect(infoSpy).toHaveBeenCalledWith("Archived blob sidecar migration in progress", {
      migrated: 1,
      failures: 0,
      currentSlot: blobSlot,
      elapsedSeconds: 31,
    });
    expect(infoSpy).toHaveBeenCalledWith(
      "Archived data column migration in progress",
      expect.objectContaining({migratedSlots: 1, migratedColumns: 1, failures: 0, currentSlot: 31})
    );
    expect(infoSpy).toHaveBeenCalledWith(
      "Archived data column migration phase complete",
      expect.objectContaining({migratedSlots: 2, migratedColumns: 2, failures: 0})
    );
  });

  it("migrates blobs with short iterators and compacts each batch", async () => {
    const startingSlot = 1000;
    const blobCount = 129;
    await blobSidecarsArchive.batchPut(
      Array.from({length: blobCount}, (_, i) => {
        const slot = startingSlot + i;
        return {
          key: slot,
          value: {blockRoot: new Uint8Array(32).fill(i % 256), slot, blobSidecars: []},
        };
      })
    );

    const store = {
      putBlobSidecars: vi.fn().mockResolvedValue(undefined),
      putDataColumnsBinary: vi.fn().mockResolvedValue(undefined),
    };
    const entriesSpy = vi.spyOn(blobSidecarsArchive, "binaryEntriesStream");
    const compactSpy = vi.spyOn(controller, "compactRange").mockResolvedValue(undefined);

    try {
      const stats = await migrateArchivedSidecars(
        config,
        blobSidecarsArchive,
        dataColumnSidecarArchive,
        store,
        controller,
        silentLogger
      );

      expect(stats.blobs).toBe(blobCount);
      expect(entriesSpy).toHaveBeenCalledTimes(2);
      expect(entriesSpy).toHaveBeenNthCalledWith(1, {limit: 128});
      expect(entriesSpy).toHaveBeenNthCalledWith(2, {gt: startingSlot + 127, limit: 128});
      expect(compactSpy).toHaveBeenCalledTimes(4);
      expect(compactSpy.mock.calls[1][0]).toEqual(compactSpy.mock.calls[0][1]);
      expect(compactSpy.mock.calls[2][0]).toEqual(compactSpy.mock.calls[1][1]);

      compactSpy.mockClear();
      await migrateArchivedSidecars(
        config,
        blobSidecarsArchive,
        dataColumnSidecarArchive,
        store,
        controller,
        silentLogger
      );
      expect(compactSpy).toHaveBeenCalledTimes(2);
    } finally {
      entriesSpy.mockRestore();
      compactSpy.mockRestore();
    }
  });

  it("does not split a column slot across migration batches", async () => {
    for (let slot = 0; slot <= SLOTS_PER_EPOCH; slot++) {
      if (slot < SLOTS_PER_EPOCH) {
        const columns = Array.from({length: NUMBER_OF_COLUMNS}, (_, index) => {
          const column = ssz.fulu.DataColumnSidecar.defaultValue();
          column.index = index;
          column.signedBlockHeader.message.slot = slot;
          return column;
        });
        await dataColumnSidecarArchive.putMany(slot, columns);
      } else {
        const column = ssz.gloas.DataColumnSidecar.defaultValue();
        column.index = 0;
        column.slot = slot;
        await dataColumnSidecarArchive.putMany(slot, [column]);
      }
    }

    const store = {
      putBlobSidecars: vi.fn().mockResolvedValue(undefined),
      putDataColumnsBinary: vi.fn().mockResolvedValue(undefined),
    };
    const entriesSpy = vi.spyOn(dataColumnSidecarArchive, "binaryEntriesStream");
    const compactSpy = vi.spyOn(controller, "compactRange").mockResolvedValue(undefined);

    try {
      const stats = await migrateArchivedSidecars(
        config,
        blobSidecarsArchive,
        dataColumnSidecarArchive,
        store,
        controller,
        silentLogger
      );

      expect(stats.columnSlots).toBe(SLOTS_PER_EPOCH + 1);
      expect(stats.columns).toBe(SLOTS_PER_EPOCH * NUMBER_OF_COLUMNS + 1);
      expect(store.putDataColumnsBinary).toHaveBeenCalledTimes(SLOTS_PER_EPOCH + 1);
      expect(entriesSpy).toHaveBeenCalledTimes(2);
      expect(entriesSpy).toHaveBeenNthCalledWith(1, {limit: SLOTS_PER_EPOCH * NUMBER_OF_COLUMNS});
      expect(entriesSpy).toHaveBeenNthCalledWith(2, {
        gt: {prefix: SLOTS_PER_EPOCH - 1, id: NUMBER_OF_COLUMNS - 1},
        limit: SLOTS_PER_EPOCH * NUMBER_OF_COLUMNS,
      });
      expect(await dataColumnSidecarArchive.values(SLOTS_PER_EPOCH - 1)).toEqual([]);
      expect(await dataColumnSidecarArchive.values(SLOTS_PER_EPOCH)).toEqual([]);
      expect(compactSpy).toHaveBeenCalledTimes(4);
    } finally {
      entriesSpy.mockRestore();
      compactSpy.mockRestore();
    }
  });

  it("keeps failed entries in LevelDB for a later retry", async () => {
    const blobSlot = 20;
    const blobRoot = new Uint8Array(32).fill(0xdd);
    await blobSidecarsArchive.add({blockRoot: blobRoot, slot: blobSlot, blobSidecars: []});

    const columnSlot = 21;
    const column = ssz.fulu.DataColumnSidecar.defaultValue();
    column.index = 5;
    column.signedBlockHeader.message.slot = columnSlot;
    await dataColumnSidecarArchive.put(columnSlot, column);

    const failingStore = {
      putBlobSidecars: vi.fn().mockRejectedValue(new Error("write failed")),
      putDataColumnsBinary: vi.fn().mockRejectedValue(new Error("write failed")),
    };
    const metrics = createMetricsTest();

    const failedStats = await migrateArchivedSidecars(
      config,
      blobSidecarsArchive,
      dataColumnSidecarArchive,
      failingStore,
      controller,
      silentLogger,
      metrics.flatFileStore
    );

    expect(failedStats.blobFailures).toBe(1);
    expect(failedStats.columnFailures).toBe(1);
    expect(await blobSidecarsArchive.get(blobSlot)).not.toBeNull();
    expect(await dataColumnSidecarArchive.values(columnSlot)).toHaveLength(1);

    const succeedingStore = {
      putBlobSidecars: vi.fn().mockResolvedValue(undefined),
      putDataColumnsBinary: vi.fn().mockResolvedValue(undefined),
    };

    const retriedStats = await migrateArchivedSidecars(
      config,
      blobSidecarsArchive,
      dataColumnSidecarArchive,
      succeedingStore,
      controller,
      silentLogger,
      metrics.flatFileStore
    );

    expect(retriedStats.blobs).toBe(1);
    expect(retriedStats.columns).toBe(1);
    expect(await blobSidecarsArchive.get(blobSlot)).toBeNull();
    expect(await dataColumnSidecarArchive.values(columnSlot)).toEqual([]);

    const migrationMetrics = await metrics.register.getSingleMetricAsString(
      "lodestar_flat_file_store_migration_writes_total"
    );
    expect(migrationMetrics).toContain(
      'lodestar_flat_file_store_migration_writes_total{store="blob",result="error"} 1'
    );
    expect(migrationMetrics).toContain(
      'lodestar_flat_file_store_migration_writes_total{store="column",result="error"} 1'
    );
    expect(migrationMetrics).toContain(
      'lodestar_flat_file_store_migration_writes_total{store="blob",result="success"} 1'
    );
    expect(migrationMetrics).toContain(
      'lodestar_flat_file_store_migration_writes_total{store="column",result="success"} 1'
    );
  });
});
