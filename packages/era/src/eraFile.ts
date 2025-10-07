import type {FileHandle} from "node:fs/promises";
import {open} from "node:fs/promises";
import {basename} from "node:path";
import {ChainForkConfig} from "@lodestar/config";
import {SLOTS_PER_HISTORICAL_ROOT} from "@lodestar/params";
import {BeaconState, SignedBeaconBlock, Slot} from "@lodestar/types";
import {E2StoreEntryType} from "./constants.js";
import {
  compressSnappyFramed,
  decompressBeaconState,
  decompressSignedBeaconBlock,
  getEraIndexes,
  getStateOffset,
  isSlotInRange,
  readBlockSlotIndexFromFile,
  readEntry,
  readEntryFromFile,
  validateEraFile,
  writeEraGroup,
} from "./helpers.js";
import type {EraIndex} from "./types.js";

/**
 * Parse era number from era filename.
 * Format: <config-name>-<era-number>-<short-historical-root>.era
 */
function parseEraNumber(filename: string): number {
  const match = filename.match(/-(\d{5})-/);
  if (!match) {
    throw new Error(`Invalid era filename format: ${filename}`);
  }
  return parseInt(match[1], 10);
}

/** An open Era file */
export class EraFile {
  readonly fh: FileHandle;
  readonly name: string;
  readonly eraNumber: number;

  private constructor(fh: FileHandle, name: string, eraNumber: number) {
    this.fh = fh;
    this.name = name;
    this.eraNumber = eraNumber;
  }

  /** Create a new era file for writing */
  static async create(path: string, eraNumber: number): Promise<EraFile> {
    const fh = await open(path, "w+");
    const name = basename(path);
    return new EraFile(fh, name, eraNumber);
  }

  /** Open an existing era file for reading */
  static async open(path: string): Promise<EraFile> {
    const fh = await open(path, "r");
    const name = basename(path);
    const eraNumber = parseEraNumber(name);
    return new EraFile(fh, name, eraNumber);
  }

  /**
   * Close the underlying file descriptor.
   * No further actions can be taken after this operation.
   */
  async close(): Promise<void> {
    await this.fh.close();
  }

  /**
   * Fully validate the era file for:
   *  - e2s format correctness
   *  - era range correctness
   *  - network correctness for state and blocks
   *  - block root and signature matches
   */
  async validate(config: ChainForkConfig): Promise<void> {
    await validateEraFile(this.fh, this.eraNumber, config);
  }

  /**
   * Create an Era index from the contents of this file.
   */
  async createIndex(): Promise<EraIndex> {
    return readBlockSlotIndexFromFile(this.fh);
  }
}

/** EraFileReader implementation */
export class EraFileReader {
  readonly era: EraFile;
  readonly index: EraIndex;
  private readonly config: ChainForkConfig;

  constructor(era: EraFile, index: EraIndex, config: ChainForkConfig) {
    this.era = era;
    this.index = index;
    this.config = config;
  }

  async readCompressedCanonicalState(): Promise<Uint8Array> {
    const offset = await getStateOffset(this.era.fh, this.era.eraNumber);
    const entry = await readEntryFromFile(this.era.fh, offset);

    if (entry.type !== E2StoreEntryType.CompressedBeaconState) {
      throw new Error(`Expected CompressedBeaconState, got ${entry.type}`);
    }

    return entry.data;
  }

  async readCanonicalState(): Promise<BeaconState> {
    const compressed = await this.readCompressedCanonicalState();
    return decompressBeaconState(compressed, this.era.eraNumber, this.config);
  }

  async readCompressedBlock(slot: Slot): Promise<Uint8Array | null> {
    // Calculate offset within the index
    const indexOffset = slot - this.index.startSlot;
    if (indexOffset < 0 || indexOffset >= this.index.indices.length) {
      throw new Error(
        `Slot ${slot} is out of range for this era file (valid range: ${this.index.startSlot} to ${this.index.startSlot + this.index.indices.length - 1})`
      );
    }

    const fileOffset = this.index.indices[indexOffset];
    if (fileOffset === 0) {
      return null; // Empty slot
    }

    const entry = await readEntryFromFile(this.era.fh, fileOffset);
    if (entry.type !== E2StoreEntryType.CompressedSignedBeaconBlock) {
      throw new Error(`Expected CompressedSignedBeaconBlock, got ${entry.type}`);
    }
    return entry.data;
  }

  async readBlock(slot: Slot): Promise<SignedBeaconBlock | null> {
    const compressed = await this.readCompressedBlock(slot);
    if (compressed === null) return null;
    return decompressSignedBeaconBlock(compressed, slot, this.config);
  }

  async validate(): Promise<void> {
    // Read entire file for validation
    const stats = await this.era.fh.stat();
    const buffer = new Uint8Array(stats.size);
    await this.era.fh.read(buffer, 0, stats.size, 0);

    // Validate e2s format and era range
    const {stateSlotIndex, blockSlotIndex} = getEraIndexes(buffer, this.era.eraNumber);

    // Validate state
    const stateOffset = stateSlotIndex.offsets[0];
    if (!stateOffset) throw new Error("No BeaconState in era file");

    const stateEntry = readEntry(buffer.subarray(stateOffset));
    if (stateEntry.type !== E2StoreEntryType.CompressedBeaconState) {
      throw new Error(`Expected CompressedBeaconState, got ${stateEntry.type}`);
    }

    const state = decompressBeaconState(stateEntry.data, this.era.eraNumber, this.config);
    const expectedStateSlot = this.era.eraNumber * SLOTS_PER_HISTORICAL_ROOT;
    if (state.slot !== expectedStateSlot) {
      throw new Error(`State slot mismatch: expected ${expectedStateSlot}, got ${state.slot}`);
    }

    // Validate blocks if not genesis
    if (blockSlotIndex) {
      for (let i = 0; i < blockSlotIndex.offsets.length; i++) {
        const offset = blockSlotIndex.offsets[i];
        if (!offset) continue; // Empty slot

        const blockEntry = readEntry(buffer.subarray(offset));
        if (blockEntry.type !== E2StoreEntryType.CompressedSignedBeaconBlock) {
          throw new Error(`Expected CompressedSignedBeaconBlock at offset ${i}, got ${blockEntry.type}`);
        }

        const slot = blockSlotIndex.startSlot + i;
        const block = decompressSignedBeaconBlock(blockEntry.data, slot, this.config);

        // Validate block slot matches
        if (block.message.slot !== slot) {
          throw new Error(`Block slot mismatch at index ${i}: expected ${slot}, got ${block.message.slot}`);
        }

        // Validate block signature exists (basic check)
        if (block.signature.length === 0) {
          throw new Error(`Block at slot ${slot} has empty signature`);
        }
      }
    }
  }
}

/** EraFileWriter implementation */
export class EraFileWriter {
  readonly era: EraFile;
  private readonly config: ChainForkConfig;
  private stateWritten = false;
  private stateSlot: Slot | undefined;
  private stateData: Uint8Array | undefined;
  private blocksBySlot = new Map<number, Uint8Array>();

  constructor(era: EraFile, config: ChainForkConfig) {
    this.era = era;
    this.config = config;
  }

  async writeCompressedCanonicalState(slot: Slot, data: Uint8Array): Promise<void> {
    if (this.stateWritten) {
      throw new Error("Canonical state has already been written");
    }
    const expectedSlot = this.era.eraNumber * SLOTS_PER_HISTORICAL_ROOT;
    if (slot !== expectedSlot) {
      throw new Error(`State slot must be ${expectedSlot} for era ${this.era.eraNumber}, got ${slot}`);
    }
    this.stateSlot = slot;
    this.stateData = data;
    this.stateWritten = true;
  }

  async writeCanonicalState(state: BeaconState): Promise<void> {
    const slot = state.slot;
    const types = this.config.getForkTypes(slot);
    const ssz = types.BeaconState.serialize(state);
    const compressed = await compressSnappyFramed(ssz);
    await this.writeCompressedCanonicalState(slot, compressed);
  }

  async writeCompressedBlock(slot: Slot, data: Uint8Array): Promise<void> {
    // Blocks in era N file are from era N-1
    if (this.era.eraNumber === 0) {
      throw new Error("Genesis era (era 0) does not contain blocks");
    }

    const blockEra = this.era.eraNumber - 1;
    if (!isSlotInRange(slot, blockEra)) {
      const expectedStartSlot = blockEra * SLOTS_PER_HISTORICAL_ROOT;
      const expectedEndSlot = expectedStartSlot + SLOTS_PER_HISTORICAL_ROOT;
      throw new Error(
        `Slot ${slot} is not in valid block range for era ${this.era.eraNumber} file (valid range: ${expectedStartSlot} to ${expectedEndSlot - 1})`
      );
    }
    this.blocksBySlot.set(slot, data);
  }

  async writeBlock(block: SignedBeaconBlock): Promise<void> {
    const slot = block.message.slot;
    const types = this.config.getForkTypes(slot);
    const ssz = types.SignedBeaconBlock.serialize(block);
    const compressed = await compressSnappyFramed(ssz);
    await this.writeCompressedBlock(slot, compressed);
  }

  async finish(): Promise<EraIndex> {
    if (!this.stateWritten || !this.stateData || this.stateSlot === undefined) {
      throw new Error("Must write canonical state before finishing");
    }

    // Helper to convert compressed data to snappy framed format (already compressed)
    const snappyFramed = (data: Uint8Array) => data;

    // Prepare blocks map with SSZ data (already compressed)
    const blocksBySlotSSZ = new Map<number, Uint8Array>();
    for (const [slot, compressed] of this.blocksBySlot) {
      blocksBySlotSSZ.set(slot, compressed);
    }

    // Write the era group
    const eraBytes = writeEraGroup({
      era: this.era.eraNumber,
      slotsPerHistoricalRoot: SLOTS_PER_HISTORICAL_ROOT,
      snappyFramed,
      blocksBySlot: blocksBySlotSSZ,
      stateSlot: this.stateSlot,
      stateSSZ: this.stateData,
    });

    // Write to file
    await this.era.fh.write(eraBytes, 0, eraBytes.length, 0);

    // Create and return index
    const {blockSlotIndex} = getEraIndexes(eraBytes, this.era.eraNumber);

    if (!blockSlotIndex) {
      // Genesis era
      return {
        startSlot: 0,
        indices: [],
      };
    }

    return {
      startSlot: blockSlotIndex.startSlot,
      indices: blockSlotIndex.offsets,
    };
  }
}
