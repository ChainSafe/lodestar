import {toHex} from "@lodestar/utils";
import {Root} from "@lodestar/types";
import {NUMBER_OF_COLUMNS} from "@lodestar/params";
import {ColumnAvailabilityStore} from "./columnAvailability.js";

const PARTS_METADATA_SIZE = Math.ceil(NUMBER_OF_COLUMNS / 8);

interface BlockColumnState {
  columns: Uint8Array;
  lastUpdated: number;
}

/**
 * In-memory implementation of column availability tracking.
 * Uses LRU eviction when capacity is reached.
 */
export class InMemoryColumnAvailabilityStore implements ColumnAvailabilityStore {
  private readonly blocks = new Map<string, BlockColumnState>();
  private readonly maxBlocks: number;
  private readonly blockTTL: number;

  constructor(opts: {maxBlocks?: number; blockTTL?: number} = {}) {
    this.maxBlocks = opts.maxBlocks ?? 64; // ~2 epochs worth
    this.blockTTL = opts.blockTTL ?? 384_000; // 32 slots * 12s
  }

  getAvailableColumns(blockRoot: Root): Uint8Array | null {
    const state = this.blocks.get(toHex(blockRoot));
    return state?.columns ?? null;
  }

  markColumnAvailable(blockRoot: Root, columnIndex: number): void {
    const key = toHex(blockRoot);
    let state = this.blocks.get(key);

    if (state === null || state === undefined) {
      this.evictIfNeeded();
      state = {
        columns: new Uint8Array(PARTS_METADATA_SIZE),
        lastUpdated: Date.now(),
      };
      this.blocks.set(key, state);
    }

    const byteIndex = Math.floor(columnIndex / 8);
    const bitIndex = columnIndex % 8;
    state.columns[byteIndex] |= 1 << bitIndex;
    state.lastUpdated = Date.now();
  }

  hasColumn(blockRoot: Root, columnIndex: number): boolean {
    const columns = this.getAvailableColumns(blockRoot);
    if (columns === null) return false;

    const byteIndex = Math.floor(columnIndex / 8);
    const bitIndex = columnIndex % 8;
    return (columns[byteIndex] & (1 << bitIndex)) !== 0;
  }

  getColumnCount(blockRoot: Root): number {
    const columns = this.getAvailableColumns(blockRoot);
    if (columns === null) return 0;
    return countBits(columns);
  }

  hasCustodyColumns(blockRoot: Root, custodyColumns: number[]): boolean {
    for (const col of custodyColumns) {
      if (!this.hasColumn(blockRoot, col)) {
        return false;
      }
    }
    return true;
  }

  pruneBlock(blockRoot: Root): void {
    this.blocks.delete(toHex(blockRoot));
  }

  private evictIfNeeded(): void {
    if (this.blocks.size < this.maxBlocks) return;

    const now = Date.now();
    // First pass: remove expired
    for (const [key, state] of this.blocks) {
      if (now - state.lastUpdated > this.blockTTL) {
        this.blocks.delete(key);
      }
    }

    // Second pass: LRU eviction if still over capacity
    if (this.blocks.size >= this.maxBlocks) {
      let oldest: {key: string; time: number} | null = null;
      for (const [key, state] of this.blocks) {
        if (oldest === null || state.lastUpdated < oldest.time) {
          oldest = {key, time: state.lastUpdated};
        }
      }
      if (oldest !== null) {
        this.blocks.delete(oldest.key);
      }
    }
  }
}

function countBits(bytes: Uint8Array): number {
  let count = 0;
  for (const byte of bytes) {
    let b = byte;
    while (b !== 0) {
      count += b & 1;
      b >>>= 1;
    }
  }
  return count;
}
