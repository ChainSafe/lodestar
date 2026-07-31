import {ChainForkConfig} from "@lodestar/config";
import {ForkPostFulu} from "@lodestar/params";
import {Slot, isGloasDataColumnSidecar, ssz} from "@lodestar/types";
import {Logger, toRootHex} from "@lodestar/utils";
import {BLOB_SIDECARS_IN_WRAPPER_INDEX} from "../repositories/blobSidecars.js";
import {BlobSidecarsArchiveRepository} from "../repositories/blobSidecarsArchive.js";
import {DataColumnSidecarArchiveRepository} from "../repositories/dataColumnSidecarArchive.js";
import type {IFlatFileStore} from "./interface.js";
import {type FlatFileStoreMetrics, FlatFileStoreMigrationResult, FlatFileStoreType} from "./metrics.js";

const BLOB_DELETE_BATCH_SIZE = 128;
const MIGRATION_PROGRESS_INTERVAL_MS = 30_000;

type MigrationStore = Pick<IFlatFileStore, "putBlobSidecars" | "putDataColumnsBinary">;

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
    let slotsToDelete: Slot[] = [];
    let startedAt: number | null = null;
    let lastProgressAt = 0;

    const deleteMigratedBlobs = async (): Promise<void> => {
      if (slotsToDelete.length === 0) return;

      await blobSidecarsArchive.batchDelete(slotsToDelete);
      stats.blobs += slotsToDelete.length;
      slotsToDelete = [];
    };

    for await (const {key, value} of blobSidecarsArchive.binaryEntriesStream()) {
      const slot = blobSidecarsArchive.decodeKey(key);
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
        await store.putBlobSidecars(slot, blockRoot, value);
        metrics?.migrationWrites.inc({store: FlatFileStoreType.blob, result: FlatFileStoreMigrationResult.success}, 1);
        slotsToDelete.push(slot);
      } catch (e) {
        stats.blobFailures++;
        metrics?.migrationWrites.inc({store: FlatFileStoreType.blob, result: FlatFileStoreMigrationResult.error}, 1);
        logger.error("Failed to migrate archived blob sidecars to flat-file storage", {slot}, e as Error);
      }

      if (slotsToDelete.length >= BLOB_DELETE_BATCH_SIZE) {
        await deleteMigratedBlobs();
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

    await deleteMigratedBlobs();
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
    let currentSlot: Slot | null = null;
    let columns: {index: number; data: Uint8Array}[] = [];
    let startedAt: number | null = null;
    let lastProgressAt = 0;

    const migrateColumnSlot = async (): Promise<void> => {
      if (currentSlot === null || columns.length === 0) return;

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
    };

    for await (const {prefix: slot, id: index, value} of dataColumnSidecarArchive.entriesStreamBinary()) {
      if (startedAt === null) {
        startedAt = Date.now();
        lastProgressAt = startedAt;
        logger.info("Migrating archived data columns to flat-file storage; startup will wait for completion", {
          startingSlot: slot,
        });
      }

      if (currentSlot !== null && slot !== currentSlot) {
        await migrateColumnSlot();
      }
      currentSlot = slot;
      columns.push({index, data: value});

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

    await migrateColumnSlot();
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
