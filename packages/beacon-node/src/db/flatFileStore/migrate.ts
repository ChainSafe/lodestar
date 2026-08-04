import {ChainForkConfig} from "@lodestar/config";
import {Db, encodeKey} from "@lodestar/db";
import {ForkPostFulu, NUMBER_OF_COLUMNS} from "@lodestar/params";
import {ColumnIndex, Slot, isGloasDataColumnSidecar, ssz} from "@lodestar/types";
import {Logger, toRootHex} from "@lodestar/utils";
import {Bucket} from "../buckets.js";
import {BLOB_SIDECARS_IN_WRAPPER_INDEX} from "../repositories/blobSidecars.js";
import {BlobSidecarsArchiveRepository} from "../repositories/blobSidecarsArchive.js";
import {DataColumnSidecarArchiveRepository} from "../repositories/dataColumnSidecarArchive.js";
import type {IFlatFileStore} from "./interface.js";
import {type FlatFileStoreMetrics, FlatFileStoreMigrationResult, FlatFileStoreType} from "./metrics.js";

const BLOB_MIGRATION_BATCH_SIZE = 128;
const COLUMN_MIGRATION_BATCH_SIZE = 32 * NUMBER_OF_COLUMNS;
const MIGRATION_PROGRESS_INTERVAL_MS = 30_000;

type MigrationStore = Pick<IFlatFileStore, "putBlobSidecarsBinary" | "putDataColumnsBinary">;
type MigrationDb = Pick<Db, "compactRange">;

export type ArchivedSidecarMigrationStats = {
  blobs: number;
  blobFailures: number;
  columnSlots: number;
  columns: number;
  columnFailures: number;
};

/**
 * Move archived sidecars from LevelDB into flat-file storage.
 *
 * Successfully written entries are removed from LevelDB. Failed entries remain
 * so a later startup can retry them.
 */
export async function migrateArchivedSidecars(
  config: ChainForkConfig,
  blobSidecarsArchive: BlobSidecarsArchiveRepository,
  dataColumnSidecarArchive: DataColumnSidecarArchiveRepository,
  store: MigrationStore,
  db: MigrationDb,
  logger: Logger,
  metrics: FlatFileStoreMetrics | null = null
): Promise<ArchivedSidecarMigrationStats> {
  const stats: ArchivedSidecarMigrationStats = {
    blobs: 0,
    blobFailures: 0,
    columnSlots: 0,
    columns: 0,
    columnFailures: 0,
  };

  try {
    const bucketStart = encodeKey(Bucket.deneb_blobSidecarsArchive, Buffer.alloc(0));
    const bucketEnd = encodeKey(Bucket.deneb_blobSidecarsArchive + 1, Buffer.alloc(0));
    let cursor: Slot | null = null;
    let compactionStart = bucketStart;
    let startedAt: number | null = null;
    let lastProgressAt = 0;

    while (true) {
      let entriesRead = 0;
      let lastSlot: Slot | null = null;
      const slotsToDelete: Slot[] = [];

      for await (const {key, value} of blobSidecarsArchive.binaryEntriesStream({
        ...(cursor === null ? {} : {gt: cursor}),
        limit: BLOB_MIGRATION_BATCH_SIZE,
      })) {
        const slot = blobSidecarsArchive.decodeKey(key);
        entriesRead++;
        cursor = slot;
        lastSlot = slot;

        if (startedAt === null) {
          startedAt = Date.now();
          lastProgressAt = startedAt;
          logger.info("Migrating archived blob sidecars to flat-file storage; startup will wait for completion", {
            startingSlot: slot,
          });
        }

        try {
          if (value.length < BLOB_SIDECARS_IN_WRAPPER_INDEX) {
            throw new Error(`Invalid archived blob sidecars length ${value.length}`);
          }

          const blockRoot = toRootHex(value.subarray(0, 32));
          await store.putBlobSidecarsBinary(slot, blockRoot, value);
          metrics?.migrationWrites.inc(
            {store: FlatFileStoreType.blob, result: FlatFileStoreMigrationResult.success},
            1
          );
          slotsToDelete.push(slot);
        } catch (e) {
          stats.blobFailures++;
          metrics?.migrationWrites.inc({store: FlatFileStoreType.blob, result: FlatFileStoreMigrationResult.error}, 1);
          logger.error("Failed to migrate archived blob sidecars to flat-file storage", {slot}, e as Error);
        }

        const now = Date.now();
        if (now - lastProgressAt >= MIGRATION_PROGRESS_INTERVAL_MS) {
          logger.info("Archived blob sidecar migration in progress", {
            migrated: stats.blobs + slotsToDelete.length,
            failures: stats.blobFailures,
            currentSlot: slot,
            elapsedSeconds: Math.floor((now - startedAt) / 1000),
          });
          lastProgressAt = now;
        }
      }

      if (lastSlot === null) break;

      if (slotsToDelete.length > 0) {
        await blobSidecarsArchive.batchDelete(slotsToDelete);
        stats.blobs += slotsToDelete.length;
      }

      const compactionEnd = blobSidecarsArchive.encodeKey(lastSlot + 1);
      logger.info("Compacting migrated archived blob sidecars in LevelDB; startup will wait for completion", {
        throughSlot: lastSlot,
      });
      await db.compactRange(compactionStart, compactionEnd);
      compactionStart = compactionEnd;
      logger.info("Archived blob sidecar migration batch complete", {
        migrated: stats.blobs,
        failures: stats.blobFailures,
        throughSlot: lastSlot,
      });

      if (entriesRead < BLOB_MIGRATION_BATCH_SIZE) break;
    }

    // Also run when the bucket is empty to reclaim deletes left by an interrupted previous migration.
    logger.info("Running final legacy blob sidecar LevelDB compaction; startup will wait for completion");
    await db.compactRange(compactionStart, bucketEnd);
    logger.info("Final legacy blob sidecar LevelDB compaction complete");

    if (startedAt !== null) {
      logger.info("Archived blob sidecar migration phase complete", {
        migrated: stats.blobs,
        failures: stats.blobFailures,
        elapsedSeconds: Math.floor((Date.now() - startedAt) / 1000),
      });
    }
  } catch (e) {
    logger.error("Failed to continue archived blob sidecar migration", {}, e as Error);
  }

  try {
    const bucketStart = encodeKey(Bucket.allForks_dataColumnSidecarsArchive, Buffer.alloc(0));
    const bucketEnd = encodeKey(Bucket.allForks_dataColumnSidecarsArchive + 1, Buffer.alloc(0));
    let cursor: {prefix: Slot; id: ColumnIndex} | null = null;
    let compactionStart = bucketStart;
    let currentSlot: Slot | null = null;
    let columns: {index: number; data: Uint8Array}[] = [];
    let startedAt: number | null = null;
    let lastProgressAt = 0;

    const migrateColumnSlot = async (): Promise<Slot | null> => {
      if (currentSlot === null || columns.length === 0) return null;

      const slot = currentSlot;
      const columnsToMigrate = columns;
      currentSlot = null;
      columns = [];
      let writeSucceeded = false;

      try {
        const dataColumnSidecarType = config.getForkTypes<ForkPostFulu>(slot).DataColumnSidecar;
        const firstColumn = dataColumnSidecarType.deserialize(columnsToMigrate[0].data);
        const blockRoot = toRootHex(
          isGloasDataColumnSidecar(firstColumn)
            ? firstColumn.beaconBlockRoot
            : ssz.phase0.BeaconBlockHeader.hashTreeRoot(firstColumn.signedBlockHeader.message)
        );

        await store.putDataColumnsBinary(slot, blockRoot, columnsToMigrate);
        writeSucceeded = true;
        metrics?.migrationWrites.inc(
          {store: FlatFileStoreType.column, result: FlatFileStoreMigrationResult.success},
          1
        );
        await dataColumnSidecarArchive.deleteMany(slot);

        stats.columnSlots++;
        stats.columns += columnsToMigrate.length;
      } catch (e) {
        stats.columnFailures += columnsToMigrate.length;
        if (!writeSucceeded) {
          metrics?.migrationWrites.inc(
            {store: FlatFileStoreType.column, result: FlatFileStoreMigrationResult.error},
            1
          );
        }
        logger.error(
          "Failed to migrate archived data column sidecars to flat-file storage",
          {slot, columns: columnsToMigrate.length},
          e as Error
        );
      }

      return slot;
    };

    while (true) {
      let entriesRead = 0;
      let lastProcessedSlot: Slot | null = null;

      for await (const {prefix: slot, id: index, value} of dataColumnSidecarArchive.binaryEntriesStream({
        ...(cursor === null ? {} : {gt: cursor}),
        limit: COLUMN_MIGRATION_BATCH_SIZE,
      })) {
        entriesRead++;

        if (startedAt === null) {
          startedAt = Date.now();
          lastProgressAt = startedAt;
          logger.info("Migrating archived data columns to flat-file storage; startup will wait for completion", {
            startingSlot: slot,
          });
        }

        if (currentSlot !== null && slot !== currentSlot) {
          lastProcessedSlot = await migrateColumnSlot();
        }
        currentSlot = slot;
        columns.push({index, data: value});
        cursor = {prefix: slot, id: index};

        const now = Date.now();
        if (now - lastProgressAt >= MIGRATION_PROGRESS_INTERVAL_MS) {
          logger.info("Archived data column migration in progress", {
            migratedSlots: stats.columnSlots,
            migratedColumns: stats.columns,
            failures: stats.columnFailures,
            currentSlot: slot,
            elapsedSeconds: Math.floor((now - startedAt) / 1000),
          });
          lastProgressAt = now;
        }
      }

      if (entriesRead < COLUMN_MIGRATION_BATCH_SIZE) {
        lastProcessedSlot = (await migrateColumnSlot()) ?? lastProcessedSlot;
      }

      if (lastProcessedSlot !== null) {
        const compactionEnd = encodeKey(
          Bucket.allForks_dataColumnSidecarsArchive,
          dataColumnSidecarArchive.getMinKeyRaw(lastProcessedSlot + 1)
        );
        logger.info("Compacting migrated archived data columns in LevelDB; startup will wait for completion", {
          throughSlot: lastProcessedSlot,
        });
        await db.compactRange(compactionStart, compactionEnd);
        compactionStart = compactionEnd;
        logger.info("Archived data column migration batch complete", {
          migratedSlots: stats.columnSlots,
          migratedColumns: stats.columns,
          failures: stats.columnFailures,
          throughSlot: lastProcessedSlot,
        });
      }

      if (entriesRead < COLUMN_MIGRATION_BATCH_SIZE) break;
    }

    // Also run when the bucket is empty to reclaim deletes left by an interrupted previous migration.
    logger.info("Running final legacy data column LevelDB compaction; startup will wait for completion");
    await db.compactRange(compactionStart, bucketEnd);
    logger.info("Final legacy data column LevelDB compaction complete");

    if (startedAt !== null) {
      logger.info("Archived data column migration phase complete", {
        migratedSlots: stats.columnSlots,
        migratedColumns: stats.columns,
        failures: stats.columnFailures,
        elapsedSeconds: Math.floor((Date.now() - startedAt) / 1000),
      });
    }
  } catch (e) {
    logger.error("Failed to continue archived data column sidecar migration", {}, e as Error);
  }

  if (stats.blobs > 0 || stats.columns > 0 || stats.blobFailures > 0 || stats.columnFailures > 0) {
    logger.info("Archived sidecar migration complete", stats);
  }

  return stats;
}
