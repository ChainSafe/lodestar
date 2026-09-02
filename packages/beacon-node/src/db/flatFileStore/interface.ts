import {DataColumnSidecar, RootHex, Slot} from "@lodestar/types";

/**
 * Flat file storage interface for data columns.
 *
 * No hot/cold distinction — data is always keyed by (slot, blockRoot).
 * All filesystem operations are crash-safe via atomic writes.
 *
 */
export interface IFlatFileStore {
  init(): Promise<void>;
  close(): Promise<void>;

  getDataColumns(slot: Slot, blockRoot: RootHex): Promise<DataColumnSidecar[]>;
  getDataColumnsBinary(slot: Slot, blockRoot: RootHex, indices: number[]): Promise<(Uint8Array | undefined)[]>;
  putDataColumnsBinary(slot: Slot, blockRoot: RootHex, columns: {index: number; data: Uint8Array}[]): Promise<void>;

  deleteMany(items: {slot: Slot; blockRoot: RootHex}[]): Promise<void>;
  pruneBefore(slot: Slot): Promise<void>;
}
