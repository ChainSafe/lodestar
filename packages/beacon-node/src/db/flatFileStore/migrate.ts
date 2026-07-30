import {ChainForkConfig} from "@lodestar/config";
import {ForkPostFulu} from "@lodestar/params";
import {Slot, isGloasDataColumnSidecar, ssz} from "@lodestar/types";
import {Logger, toRootHex} from "@lodestar/utils";
import {BLOB_SIDECARS_IN_WRAPPER_INDEX} from "../repositories/blobSidecars.js";
import {BlobSidecarsArchiveRepository} from "../repositories/blobSidecarsArchive.js";
import {DataColumnSidecarArchiveRepository} from "../repositories/dataColumnSidecarArchive.js";
import type {IFlatFileStore} from "./interface.js";

const BLOB_DELETE_BATCH_SIZE = 128;

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
  logger: Logger
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

    const deleteMigratedBlobs = async (): Promise<void> => {
      if (slotsToDelete.length === 0) return;

      await blobSidecarsArchive.batchDelete(slotsToDelete);
      stats.blobs += slotsToDelete.length;
      slotsToDelete = [];
    };

    for await (const {key, value} of blobSidecarsArchive.binaryEntriesStream()) {
      const slot = blobSidecarsArchive.decodeKey(key);
      try {
        if (value.length < BLOB_SIDECARS_IN_WRAPPER_INDEX) {
          throw new Error(`Invalid archived blob sidecars length ${value.length}`);
        }

        const blockRoot = toRootHex(value.subarray(0, 32));
        await store.putBlobSidecars(slot, blockRoot, value);
        slotsToDelete.push(slot);
      } catch (e) {
        stats.blobFailures++;
        logger.error("Failed to migrate archived blob sidecars to flat-file storage", {slot}, e as Error);
      }

      if (slotsToDelete.length >= BLOB_DELETE_BATCH_SIZE) {
        await deleteMigratedBlobs();
      }
    }

    await deleteMigratedBlobs();
  } catch (e) {
    logger.error("Failed to continue archived blob sidecar migration", {}, e as Error);
  }

  try {
    let currentSlot: Slot | null = null;
    let columns: {index: number; data: Uint8Array}[] = [];

    const migrateColumnSlot = async (): Promise<void> => {
      if (currentSlot === null || columns.length === 0) return;

      const slot = currentSlot;
      const columnsToMigrate = columns;
      currentSlot = null;
      columns = [];

      try {
        const dataColumnSidecarType = config.getForkTypes<ForkPostFulu>(slot).DataColumnSidecar;
        const firstColumn = dataColumnSidecarType.deserialize(columnsToMigrate[0].data);
        const blockRoot = toRootHex(
          isGloasDataColumnSidecar(firstColumn)
            ? firstColumn.beaconBlockRoot
            : ssz.phase0.BeaconBlockHeader.hashTreeRoot(firstColumn.signedBlockHeader.message)
        );

        await store.putDataColumnsBinary(slot, blockRoot, columnsToMigrate);
        await dataColumnSidecarArchive.deleteMany(slot);

        stats.columnSlots++;
        stats.columns += columnsToMigrate.length;
      } catch (e) {
        stats.columnFailures += columnsToMigrate.length;
        logger.error(
          "Failed to migrate archived data column sidecars to flat-file storage",
          {slot, columns: columnsToMigrate.length},
          e as Error
        );
      }
    };

    for await (const {prefix: slot, id: index, value} of dataColumnSidecarArchive.entriesStreamBinary()) {
      if (currentSlot !== null && slot !== currentSlot) {
        await migrateColumnSlot();
      }
      currentSlot = slot;
      columns.push({index, data: value});
    }

    await migrateColumnSlot();
  } catch (e) {
    logger.error("Failed to continue archived data column sidecar migration", {}, e as Error);
  }

  if (stats.blobs > 0 || stats.columns > 0 || stats.blobFailures > 0 || stats.columnFailures > 0) {
    logger.info("Archived sidecar migration complete", stats);
  }

  return stats;
}
