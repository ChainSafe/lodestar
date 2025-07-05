import {Slot} from "@lodestar/types";
import {E2StoreEntryType} from "./constants.js";

/**
 * Known entry types in an E2Store (.e2s) fil+ Snappy framing format.
 * Encoding: snappyFramed(ssz(SignedBeaconBlock))
 */
export interface CompressedSignedBeaconBlock {
  type: typeof E2StoreEntryType.CompressedSignedBeaconBlock;
  data: Uint8Array;
}

/**
 * A compressed BeaconState using SSZ + Snappy framing format.
 * Encoding: snappyFramed(ssz(BeaconState))
 */
export interface CompressedBeaconState {
  type: typeof E2StoreEntryType.CompressedBeaconState;
  data: Uint8Array;
}

/**
 * Parsed components of an .era file name.
 * Format: <config-name>-<era-number>-<era-count>-<short-historical-root>.era
 */
export interface EraFileName {
  /** CONFIG_NAME field of runtime config (mainnet, sepolia, holesky, etc.) */
  configName: string;
  /** Number of the first era stored in file, 5-digit zero-padded (00000, 00001, etc.) */
  eraNumber: number;
  /** Number of eras stored in file, 5-digit zero-padded (00000, 00001, etc.) */
  eraCount: number;
  /** First 4 bytes of last historical root, lower-case hex-encoded (8 chars) */
  shortHistoricalRoot: string;
}

/**
 * Complete era file with potentially multiple groups.
 * Era files with multiple eras use the era number of the lowest era stored.
 */
export interface EraFile {
  groups: EraGroup[];
  fileName?: string;
  fileNameInfo?: EraFileName;
}

/**
 * Structured content of a single era file group.
 * High-level representation after parsing the raw era file.
 * Era files can contain multiple groups - groups can freely be split and combined.
 */
export interface EraGroup {
  eraNumber: number;
  version: VersionRecord;
  blocks: {slot: Slot; block: CompressedSignedBeaconBlock}[];
  state: CompressedBeaconState;
  blockIndex?: SlotIndex; // Optional for genesis era (era 0)
  stateIndex: SlotIndex;
  otherEntries?: E2StoreEntry[]; // Extension point for future record types
}

/**
 * Logical, parsed entry from an E2Store file.
 */
export interface E2StoreEntry {
  type: (typeof E2StoreEntryType)[keyof typeof E2StoreEntryType];
  data: Uint8Array;
}

/**
 * Version record data. Always empty but indicates e2store format version.
 * The first 8 bytes of an e2s file are always [0x65, 0x32, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]
 */
export interface VersionRecord {
  type: typeof E2StoreEntryType.Version;
  data: Uint8Array; // (length 0)
}

/**
 * Maps slots to file positions in an era file.
 * - Block index: count = SLOTS_PER_HISTORICAL_ROOT, maps slots to blocks
 * - State index: count = 1, points to the era state
 * - Zero offset = empty slot (no block)
 */
export interface SlotIndex {
  /** First slot covered by this index (era * SLOTS_PER_HISTORICAL_ROOT) */
  startSlot: Slot;
  /** File positions where data can be found. Length varies by index type. */
  offsets: bigint[];
  /** Number of offsets in the index (stored at end of record for backward reading) */
  count: bigint;
}

/**
 * 8-byte header for every entry in an E2Store file.
 * Format: type (2 bytes) | length (4 bytes) | reserved (2 bytes)
 */
export interface E2StoreHeader {
  type: (typeof E2StoreEntryType)[keyof typeof E2StoreEntryType];
  length: number; // uint32 little-endian
  reserved: number; // uint16 little-endian, must be 0
}

/**
 * Standalone .e2i index file.
 *
 * SlotIndex records can appear in standalone files ending with .e2i
 *
 * Key differences from embedded indices:
 * - File name ends with .e2i by convention
 * - Offsets are negative and counted from the end of the data file
 * - Can be appended to data file without changing contents
 */
export interface StandaloneIndexFile {
  /** File name, should end with .e2i */
  fileName: string;
  /** The slot index data */
  slotIndex: SlotIndex;
  /** Always true to indicate this is a standalone index with negative offsets */
  isStandalone: true;
}
