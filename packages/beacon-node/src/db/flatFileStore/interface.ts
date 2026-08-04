import {DataColumnSidecar, RootHex, Slot, deneb} from "@lodestar/types";
import {BlobSidecarsWrapper} from "../repositories/blobSidecars.js";

/**
 * Flat file storage interface for blobs and data columns.
 *
 * No hot/cold distinction — data is always keyed by (slot, blockRoot).
 * All filesystem operations are crash-safe via atomic writes.
 *
 * For finalized canonical lookups by slot only, the existence cache resolves
 * slot → root when exactly one root exists (no separate index needed).
 */
export interface IFlatFileStore {
  init(finalizedCheckpointSlot: Slot): Promise<void>;
  close(): Promise<void>;

  // --- Blobs ---

  getBlobSidecars(slot: Slot, blockRoot: RootHex): Promise<BlobSidecarsWrapper | null>;
  getBlobSidecarsBinary(slot: Slot, blockRoot: RootHex): Promise<Uint8Array | null>;
  /** Lookup by slot only when a single blob root exists */
  getBlobSidecarsBinaryBySlot(slot: Slot): Promise<Uint8Array | null>;
  putBlobSidecars(slot: Slot, blockRoot: RootHex, blobSidecars: deneb.BlobSidecars): Promise<void>;
  putBlobSidecarsBinary(slot: Slot, blockRoot: RootHex, data: Uint8Array): Promise<void>;

  // --- Columns ---

  getDataColumns(slot: Slot, blockRoot: RootHex): Promise<DataColumnSidecar[]>;
  getDataColumnsBinary(slot: Slot, blockRoot: RootHex, indices: number[]): Promise<(Uint8Array | undefined)[]>;
  putDataColumnsBinary(slot: Slot, blockRoot: RootHex, columns: {index: number; data: Uint8Array}[]): Promise<void>;

  /** Lookup by slot only when a single column root exists */
  getDataColumnsBinaryBySlot(slot: Slot, indices: number[]): Promise<(Uint8Array | undefined)[]>;

  // --- Pruning ---

  deleteNonCanonical(items: {slot: Slot; blockRoot: RootHex}[]): Promise<void>;
  pruneBlobsBeforeSlot(slot: Slot): Promise<void>;
  pruneColumnsBeforeSlot(slot: Slot): Promise<void>;
}
