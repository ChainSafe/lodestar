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
  /** Returns null if the file is absent, and undefined entries for columns missing from an existing file. */
  getDataColumnsBinary(slot: Slot, blockRoot: RootHex, indices: number[]): Promise<(Uint8Array | undefined)[] | null>;
  putDataColumnsBinary(slot: Slot, blockRoot: RootHex, columns: {index: number; data: Uint8Array}[]): Promise<void>;

  deleteMany(items: {slot: Slot; blockRoot: RootHex}[]): Promise<void>;
  pruneBefore(slot: Slot): Promise<Slot[]>;
}
