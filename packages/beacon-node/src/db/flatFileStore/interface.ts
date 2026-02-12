import {RootHex, Slot, fulu} from "@lodestar/types";
import {BlobSidecarsWrapper} from "../repositories/blobSidecars.js";

/**
 * Flat file storage interface for blobs and data columns.
 *
 * No hot/cold distinction — data is always keyed by (slot, blockRoot).
 * All filesystem operations are crash-safe via atomic writes.
 *
 * For finalized canonical lookups by slot only, the existence cache resolves
 * slot → root from data it already tracks (no separate index needed).
 */
export interface IFlatFileStore {
  init(): Promise<void>;
  close(): Promise<void>;

  // --- Blobs ---

  getBlobSidecars(slot: Slot, blockRoot: RootHex): Promise<BlobSidecarsWrapper | null>;
  getBlobSidecarsBinary(slot: Slot, blockRoot: RootHex): Promise<Uint8Array | null>;
  /** Lookup by slot only (for finalized reqresp — single canonical file per slot) */
  getBlobSidecarsBinaryBySlot(slot: Slot): Promise<Uint8Array | null>;
  putBlobSidecars(slot: Slot, blockRoot: RootHex, data: Uint8Array): Promise<void>;
  deleteBlobSidecars(slot: Slot, blockRoot: RootHex): Promise<void>;
  /** Sync check from in-memory cache */
  hasBlobSidecars(slot: Slot, blockRoot: RootHex): boolean;

  /** Stream binary blob sidecar entries for finalized range (for reqresp blobSidecarsByRange) */
  blobSidecarsBinaryEntriesStream(opts: {gte: Slot; lt: Slot}): AsyncIterable<{slot: Slot; data: Uint8Array}>;

  // --- Columns ---

  getDataColumns(slot: Slot, blockRoot: RootHex): Promise<fulu.DataColumnSidecar[]>;
  getDataColumnsBinary(slot: Slot, blockRoot: RootHex, indices: number[]): Promise<(Uint8Array | undefined)[]>;
  putDataColumnsBinary(slot: Slot, blockRoot: RootHex, columns: {index: number; data: Uint8Array}[]): Promise<void>;
  putDataColumns(slot: Slot, blockRoot: RootHex, columns: fulu.DataColumnSidecar[]): Promise<void>;
  deleteDataColumns(slot: Slot, blockRoot: RootHex): Promise<void>;
  /** Sync check from in-memory cache */
  hasDataColumn(slot: Slot, blockRoot: RootHex, index: number): boolean;
  getColumnBitmap(slot: Slot, blockRoot: RootHex): bigint | null;

  /** Lookup by slot only (for finalized reqresp — single canonical file per slot) */
  getDataColumnsBinaryBySlot(slot: Slot, indices: number[]): Promise<(Uint8Array | undefined)[]>;

  // --- Pruning ---

  deleteNonCanonical(items: {slot: Slot; blockRoot: RootHex}[]): Promise<void>;
  pruneBlobsBeforeSlot(slot: Slot): Promise<void>;
  pruneColumnsBeforeSlot(slot: Slot): Promise<void>;
  pruneHotBlobs(): Promise<void>;
}
