import type {ChainForkConfig} from "@lodestar/config";
import {Slot} from "@lodestar/types";
import {E2StoreEntryType} from "./constants.js";

/**
 * Parsed components of an .era file name.
 * Format: <config-name>-<era-number>-<short-historical-root>.era
 */
export interface EraFileName {
  /** CONFIG_NAME field of runtime config (mainnet, sepolia, holesky, etc.) */
  configName: string;
  /** Number of the first era stored in file, 5-digit zero-padded (00000, 00001, etc.) */
  eraNumber: number;
  /** First 4 bytes of last historical root, lower-case hex-encoded (8 chars) */
  shortHistoricalRoot: string;
}

/**
 * Logical, parsed entry from an E2Store file.
 */
export interface E2StoreEntry {
  type: E2StoreEntryType;
  data: Uint8Array;
}

/**
 * Maps slots to file positions in an era file.
 * - Block index: count = SLOTS_PER_HISTORICAL_ROOT, maps slots to blocks
 * - State index: count = 1, points to the era state
 * - Zero offset = empty slot (no block)
 */
export interface SlotIndex {
  type: E2StoreEntryType.SlotIndex;
  /** First slot covered by this index (era * SLOTS_PER_HISTORICAL_ROOT) */
  startSlot: Slot;
  /** File positions where data can be found. Length varies by index type. */
  offsets: number[];
  /** File position where this index record starts */
  recordStart: number;
}

/** Data read from a slot index file */
export interface EraIndex {
  startSlot: number;
  indices: number[];
}

/** An open Era file */
export interface EraFile {
  /** file descriptor */
  fd: number;
  name: string;
  eraNumber: number;

  /**
   * Convenience method to close the underlying file descriptor.
   * No further actions can be taken after this operation.
   */
  close(): Promise<void>;

  /**
   * Fully validate the era file for:
   *  - e2s format correctness
   *  - era range correctness
   *  - network correctness for state and blocks
   *  - block root and signature matches
   */
  validate(config: ChainForkConfig): Promise<void>;

  /**
   * Create an Era index from the contents of this file.
   */
  createIndex(): Promise<EraIndex>;
}
