import {Root} from "@lodestar/types";

/**
 * Tracks which data columns are available locally for each block.
 * This is the source of truth for our "HAVE set" in partial messages.
 */
export interface ColumnAvailabilityStore {
  /**
   * Returns bitmap of columns available for a block.
   * Bit N is set if column N is available.
   */
  getAvailableColumns(blockRoot: Root): Uint8Array | null;

  /**
   * Marks a column as available for a block.
   */
  markColumnAvailable(blockRoot: Root, columnIndex: number): void;

  /**
   * Checks if a specific column is available.
   */
  hasColumn(blockRoot: Root, columnIndex: number): boolean;

  /**
   * Returns count of available columns for a block.
   */
  getColumnCount(blockRoot: Root): number;

  /**
   * Checks if all custody columns are available (for sampling).
   */
  hasCustodyColumns(blockRoot: Root, custodyColumns: number[]): boolean;

  /**
   * Removes tracking for a block (after finalization).
   */
  pruneBlock(blockRoot: Root): void;
}
