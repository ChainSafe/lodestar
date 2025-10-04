import type {FileHandle} from "node:fs/promises";
import {open, readFile, writeFile} from "node:fs/promises";
import {basename} from "node:path";
import {Uint8ArrayList} from "uint8arraylist";
import {ChainForkConfig} from "@lodestar/config";
import {SLOTS_PER_HISTORICAL_ROOT} from "@lodestar/params";
import {BeaconState, SignedBeaconBlock, Slot} from "@lodestar/types";
import {encodeSnappy} from "../../reqresp/src/encodingStrategies/sszSnappy/snappyFrames/compress.js";
import {SnappyFramesUncompress} from "../../reqresp/src/encodingStrategies/sszSnappy/snappyFrames/uncompress.js";
import {E2STORE_HEADER_SIZE, E2StoreEntryType, EraTypes, VERSION_RECORD_BYTES} from "./constants.js";
import type {E2StoreEntry, EraFile, EraIndex, SlotIndex} from "./types.js";

/** Shared 8-byte scratch and DataView to avoid per-call allocations for i64 read/write */
const scratch64 = new ArrayBuffer(8);
const scratch64View = new DataView(scratch64);
const scratch64Bytes = new Uint8Array(scratch64);

/**
 * Read an e2Store entry (header + data)
 * Header: 2 bytes type + 4 bytes length (LE) + 2 bytes reserved (must be 0)
 */
export function readEntry(bytes: Uint8Array): E2StoreEntry {
  if (bytes.length < E2STORE_HEADER_SIZE) {
    throw new Error(`Buffer too small for E2Store header: need ${E2STORE_HEADER_SIZE} bytes, got ${bytes.length}`);
  }

  // validate entry type from first 2 bytes
  const typeBytes = bytes.subarray(0, 2);
  const typeEntry = Object.entries(EraTypes).find(
    ([, expectedBytes]) => typeBytes[0] === expectedBytes[0] && typeBytes[1] === expectedBytes[1]
  );
  if (!typeEntry) {
    const typeHex = Array.from(typeBytes)
      .map((b) => `0x${b.toString(16).padStart(2, "0")}`)
      .join(", ");
    throw new Error(`Unknown E2Store entry type: [${typeHex}]`);
  }
  const type = typeEntry[0] as E2StoreEntryType;

  // Parse data length from next 4 bytes (offset 2, little endian)
  const lengthView = new DataView(bytes.buffer, bytes.byteOffset + 2, 4);
  const length = lengthView.getUint32(0, true);

  // Validate reserved bytes are zero (offset 6-7)
  const reserved = bytes[6] | (bytes[7] << 8);
  if (reserved !== 0) {
    throw new Error(`E2Store reserved bytes must be zero, got: ${reserved}`);
  }

  // Validate data length fits within buffer
  const availableDataLength = bytes.length - E2STORE_HEADER_SIZE;
  if (length > availableDataLength) {
    throw new Error(`E2Store data length ${length} exceeds available buffer space ${availableDataLength}`);
  }

  const dataStartOffset = E2STORE_HEADER_SIZE;
  const data = bytes.subarray(dataStartOffset, dataStartOffset + length);

  return {type, data};
}

/** Read 64-bit signed integer (little-endian) at offset. */
function readInt64(bytes: Uint8Array, offset: number): bigint {
  // Copy 8 bytes into shared scratch, then read via shared DataView
  scratch64Bytes.set(bytes.subarray(offset, offset + 8));
  return scratch64View.getBigInt64(0, true);
}

/**
 * Read a SlotIndex from the end of the buffer with validation.
 * Validates expected count, entry type and payload size, offset bounds,
 * and trailing count.
 */
function readSlotIndex(bytes: Uint8Array, expectedType: "state" | "block"): SlotIndex {
  if (bytes.length < 8) {
    throw new Error("Buffer too small for SlotIndex count");
  }
  const countOffset = bytes.length - 8;
  const eofCount = Number(readInt64(bytes, countOffset));

  // Validate count matches expected type requirements
  if (expectedType === "state" && eofCount !== 1) {
    throw new Error(`State index must have count=1, got ${eofCount}`);
  }
  if (expectedType === "block" && eofCount !== SLOTS_PER_HISTORICAL_ROOT) {
    throw new Error(`Block index must have count=${SLOTS_PER_HISTORICAL_ROOT}, got ${eofCount}`);
  }

  // Calculate where slot index starts in buffer
  // Structure: header(8) + startSlot(8) + offsets(count*8) + count(8)
  const indexSize = E2STORE_HEADER_SIZE + 16 + eofCount * 8;
  const indexStart = bytes.length - indexSize;

  // Validate index position is within file bounds
  if (indexStart < 0) {
    throw new Error(`SlotIndex position ${indexStart} is invalid - file too small for count=${eofCount}`);
  }

  // Read and validate the slot index entry
  const entry = readEntry(bytes.subarray(indexStart));
  if (entry.type !== E2StoreEntryType.SlotIndex) {
    throw new Error(`Expected SlotIndex entry, got ${entry.type}`);
  }

  // Size: startSlot(8) + offsets(count*8) + count(8) = count*8 + 16
  const expectedSize = eofCount * 8 + 16;
  if (entry.data.length !== expectedSize) {
    throw new Error(`SlotIndex payload size must be exactly ${expectedSize} bytes, got ${entry.data.length}`);
  }

  // Parse start slot from payload
  const startSlot = Number(readInt64(entry.data, 0));

  // Parse slot offsets with relative→absolute conversion
  const offsets: number[] = [];
  for (let i = 0; i < eofCount; i++) {
    // Offset field position: after startSlot(8) + i * 8
    const offsetFieldOffset = 8 + i * 8;
    const relativeOffset = readInt64(entry.data, offsetFieldOffset);

    if (relativeOffset === 0n) {
      offsets.push(0);
    } else {
      // Convert relative offset to absolute header position with bounds validation
      const indexHeaderStart = BigInt(indexStart);
      const absoluteHeaderOffset = indexHeaderStart + relativeOffset;
      if (absoluteHeaderOffset < 0n || absoluteHeaderOffset >= BigInt(bytes.length)) {
        throw new Error(
          `Invalid absolute offset: ${absoluteHeaderOffset} (relative: ${relativeOffset}, ` +
            `indexStart: ${indexStart}, fileSize: ${bytes.length})`
        );
      }
      offsets.push(Number(absoluteHeaderOffset));
    }
  }

  // Trailing count position: after startSlot(8) + offsets(count*8)
  const trailingCountOffset = 8 + eofCount * 8;
  const trailingCount = Number(readInt64(entry.data, trailingCountOffset));
  if (trailingCount !== eofCount) {
    throw new Error(`SlotIndex trailing count mismatch: expected ${eofCount}, got ${trailingCount}`);
  }

  return {
    type: E2StoreEntryType.SlotIndex,
    startSlot,
    offsets,
    recordStart: indexStart,
  };
}

/**
 * Read state and block SlotIndex entries from an era file and validate alignment.
 */
function getEraIndexes(
  eraBytes: Uint8Array,
  expectedEra?: number
): {stateSlotIndex: SlotIndex; blockSlotIndex?: SlotIndex} {
  const stateSlotIndex = readSlotIndex(eraBytes, "state");

  // Validate state index aligns with expected era boundary
  if (expectedEra !== undefined) {
    const expectedStateStartSlot = expectedEra * SLOTS_PER_HISTORICAL_ROOT;
    if (stateSlotIndex.startSlot !== expectedStateStartSlot) {
      throw new Error(
        `State index era alignment error: expected startSlot=${expectedStateStartSlot} ` +
          `(era ${expectedEra}), got startSlot=${stateSlotIndex.startSlot}`
      );
    }
  }

  // Read block index if not genesis era (era 0)
  let blockSlotIndex: SlotIndex | undefined;
  if (stateSlotIndex.startSlot > 0) {
    const blockIndexBytes = eraBytes.subarray(0, stateSlotIndex.recordStart);
    blockSlotIndex = readSlotIndex(blockIndexBytes, "block");

    // Validate block and state indices are properly aligned
    const expectedBlockStartSlot = stateSlotIndex.startSlot - SLOTS_PER_HISTORICAL_ROOT;
    if (blockSlotIndex.startSlot !== expectedBlockStartSlot) {
      throw new Error(
        `Block index alignment error: expected startSlot=${expectedBlockStartSlot}, ` +
          `got startSlot=${blockSlotIndex.startSlot} (should be exactly one era before state)`
      );
    }
  }

  return {stateSlotIndex, blockSlotIndex};
}

/** Decompress snappy-framed data  */
function decompressFrames(compressedData: Uint8Array): Uint8Array {
  const decompressor = new SnappyFramesUncompress();

  const input = new Uint8ArrayList(compressedData);
  const result = decompressor.uncompress(input);

  if (result === null) {
    throw new Error("Snappy decompression failed - no data returned");
  }

  return result.subarray();
}

/** Decompress and deserialize a BeaconState using the apt fork for the era. */
function decompressBeaconState(compressedData: Uint8Array, era: number, config: ChainForkConfig) {
  const uncompressed = decompressFrames(compressedData);

  const stateSlot = era * SLOTS_PER_HISTORICAL_ROOT;
  const types = config.getForkTypes(stateSlot);

  try {
    return types.BeaconState.deserialize(uncompressed);
  } catch (error) {
    throw new Error(`Failed to deserialize BeaconState for era ${era}, slot ${stateSlot}: ${error}`);
  }
}

/** Decompress and deserialize a SignedBeaconBlock using the fork for the given slot. */
function decompressSignedBeaconBlock(compressedData: Uint8Array, blockSlot: number, config: ChainForkConfig) {
  const uncompressed = decompressFrames(compressedData);

  const types = config.getForkTypes(blockSlot);

  try {
    return types.SignedBeaconBlock.deserialize(uncompressed);
  } catch (error) {
    throw new Error(`Failed to deserialize SignedBeaconBlock for slot ${blockSlot}: ${error}`);
  }
}

type SnappyFramedCompress = (ssz: Uint8Array) => Uint8Array;

/**
 * Write a single E2Store TLV entry (header + payload)
 * Header layout: type[2] | length u32 LE | reserved u16(=0)
 */
function writeEntry(type2: Uint8Array, payload: Uint8Array): Uint8Array {
  if (type2.length !== 2) throw new Error("type must be 2 bytes");
  const out = new Uint8Array(E2STORE_HEADER_SIZE + payload.length);
  // type
  out[0] = type2[0];
  out[1] = type2[1];
  // length u32 LE
  out[2] = payload.length & 0xff;
  out[3] = (payload.length >>> 8) & 0xff;
  out[4] = (payload.length >>> 16) & 0xff;
  out[5] = (payload.length >>> 24) & 0xff;
  // reserved u16 = 0 at [6..7]
  out.set(payload, E2STORE_HEADER_SIZE);
  return out;
}

/** In-place encode of a 64-bit signed integer (little-endian) into target at offset. */
function writeI64LEInto(target: Uint8Array, offset: number, v: bigint): void {
  scratch64View.setBigInt64(0, v, true);
  target.set(scratch64Bytes, offset);
}
function readI64LE(buf: Uint8Array, off: number): bigint {
  const dv = new DataView(buf.buffer, buf.byteOffset + off, 8);
  return dv.getBigInt64(0, true);
}
/**
 * Build SlotIndex payload: startSlot | offsets[count] | count.
 * Offsets are i64 relative to the index record start (0 = missing).
 * Payload size = count*8 + 16 (header not included).
 */
function buildSlotIndexData(startSlot: number, offsetsAbs: readonly number[], indexRecordStart: number): Uint8Array {
  const count = offsetsAbs.length;
  const payload = new Uint8Array(count * 8 + 16);

  // startSlot
  writeI64LEInto(payload, 0, BigInt(startSlot));

  // offsets (relative to beginning of index record)
  let off = 8;
  for (let i = 0; i < count; i++, off += 8) {
    const abs = offsetsAbs[i];
    const rel = abs === 0 ? 0n : BigInt(abs - indexRecordStart);
    writeI64LEInto(payload, off, rel);
  }

  // trailing count
  writeI64LEInto(payload, 8 + count * 8, BigInt(count));
  return payload;
}

/** Compressed record helpers (snappy framed) */
function writeCompressedBlock(ssz: Uint8Array, snappyFramed: SnappyFramedCompress): Uint8Array {
  const framed = snappyFramed(ssz);
  return writeEntry(EraTypes[E2StoreEntryType.CompressedSignedBeaconBlock], framed);
}

function writeCompressedState(ssz: Uint8Array, snappyFramed: SnappyFramedCompress): Uint8Array {
  const framed = snappyFramed(ssz);
  return writeEntry(EraTypes[E2StoreEntryType.CompressedBeaconState], framed);
}

/** Concatenate an array of Uint8Array into a single Uint8Array. */
function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of chunks) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

/**
 * Write a single era group to bytes.
 * Layout: Version | block* | era-state | SlotIndex(block)? | SlotIndex(state)
 * Genesis (era 0): omit block index; always include state index (count=1).
 */
function writeEraGroup(params: {
  era: number;
  slotsPerHistoricalRoot: number;
  snappyFramed: SnappyFramedCompress;
  blocksBySlot: Map<number, Uint8Array>;
  stateSlot: number;
  stateSSZ: Uint8Array;
}): Uint8Array {
  const {era, slotsPerHistoricalRoot: SPR, snappyFramed, blocksBySlot, stateSlot, stateSSZ} = params;

  if (stateSlot !== era * SPR) throw new Error(`stateSlot must be era*SPR (${era * SPR}), got ${stateSlot}`);

  const chunks: Uint8Array[] = [];
  let cursor = 0;
  const push = (b: Uint8Array) => {
    chunks.push(b);
    cursor += b.length;
  };

  // 1) Version (begin group)
  push(VERSION_RECORD_BYTES);

  // 2) Blocks window
  const firstBlockSlot = era === 0 ? 0 : stateSlot - SPR;
  const blockOffsetsAbs = new Array<number>(era === 0 ? 0 : SPR).fill(0);
  if (era > 0) {
    for (let slot = firstBlockSlot; slot < stateSlot; slot++) {
      const ssz = blocksBySlot.get(slot);
      if (!ssz) continue; // empty slot
      const rec = writeCompressedBlock(ssz, snappyFramed);
      const headerPos = cursor;
      push(rec);
      // Store header-start offsets (legacy/header-start semantics)
      blockOffsetsAbs[slot - firstBlockSlot] = headerPos;
    }
  }

  // 3) State (exactly one)
  const stateRec = writeCompressedState(stateSSZ, snappyFramed);
  const stateHeaderPos = cursor;
  push(stateRec);

  // 4) Block index (omit for genesis)
  if (era > 0) {
    const idxHeaderStart = cursor; // beginning of SlotIndex entry
    const data = buildSlotIndexData(firstBlockSlot, blockOffsetsAbs, idxHeaderStart);
    push(writeEntry(EraTypes[E2StoreEntryType.SlotIndex], data));
  }

  // 5) State index (count=1; startSlot = stateSlot)
  {
    const idxHeaderStart = cursor;
    const data = buildSlotIndexData(stateSlot, [stateHeaderPos], idxHeaderStart);
    push(writeEntry(EraTypes[E2StoreEntryType.SlotIndex], data));
  }

  return concat(chunks);
}

/**
 * Read an era index file from disk.
 * Format: startSlot (i64 LE) | count (i64 LE) | indices[count] (i64 LE each)
 */
export async function readEraIndexFile(path: string): Promise<EraIndex> {
  const buffer = await readFile(path);

  if (buffer.length < 16) {
    throw new Error(`Index file too small: need at least 16 bytes, got ${buffer.length}`);
  }

  const startSlot = Number(readI64LE(buffer, 0));
  const count = Number(readI64LE(buffer, 8));

  const expectedSize = 16 + count * 8;
  if (buffer.length !== expectedSize) {
    throw new Error(`Index file size mismatch: expected ${expectedSize} bytes, got ${buffer.length}`);
  }

  const indices: number[] = [];
  for (let i = 0; i < count; i++) {
    indices.push(Number(readI64LE(buffer, 16 + i * 8)));
  }

  return {startSlot, indices};
}

/**
 * Write an era index file to disk.
 * Format: startSlot (i64 LE) | count (i64 LE) | indices[count] (i64 LE each)
 */
export async function writeEraIndexFile(path: string, index: EraIndex): Promise<void> {
  const count = index.indices.length;
  const buffer = new Uint8Array(16 + count * 8);

  // Write startSlot
  writeI64LEInto(buffer, 0, BigInt(index.startSlot));

  // Write count
  writeI64LEInto(buffer, 8, BigInt(count));

  // Write indices
  for (let i = 0; i < count; i++) {
    writeI64LEInto(buffer, 16 + i * 8, BigInt(index.indices[i]));
  }

  await writeFile(path, buffer);
}

/** Return true if `slot` is within the era range */
export function isSlotInRange(slot: Slot, eraNumber: number): boolean {
  const eraStartSlot = eraNumber * SLOTS_PER_HISTORICAL_ROOT;
  const eraEndSlot = eraStartSlot + SLOTS_PER_HISTORICAL_ROOT;
  return slot >= eraStartSlot && slot < eraEndSlot;
}

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

/** Create a new era file for writing */
export async function createEraFile(path: string, eraNumber: number): Promise<EraFile> {
  const fh = await open(path, "w+");
  const name = basename(path);

  // Register the file handle
  fileHandles.set(fh.fd, fh);

  const eraFile: EraFile = {
    fd: fh.fd,
    name,
    eraNumber,

    async close() {
      fileHandles.delete(fh.fd);
      await fh.close();
    },

    async validate(config: ChainForkConfig): Promise<void> {
      await validateEraFile(fh.fd, eraNumber, config);
    },

    async createIndex(): Promise<EraIndex> {
      // Read the entire file to extract the slot index
      const stats = await fh.stat();
      const buffer = new Uint8Array(stats.size);
      await fh.read(buffer, 0, stats.size, 0);

      // Get the block slot index from the era file
      const {blockSlotIndex} = getEraIndexes(buffer, eraNumber);

      if (!blockSlotIndex) {
        // Genesis era (era 0) has no block index
        return {
          startSlot: 0,
          indices: [],
        };
      }

      return {
        startSlot: blockSlotIndex.startSlot,
        indices: blockSlotIndex.offsets,
      };
    },
  };

  return eraFile;
}

/** Open an era file and return an EraFile handle */
export async function openEraFile(path: string): Promise<EraFile> {
  const fh = await open(path, "r");
  const name = basename(path);
  const eraNumber = parseEraNumber(name);

  // Register the file handle
  fileHandles.set(fh.fd, fh);

  const eraFile: EraFile = {
    fd: fh.fd,
    name,
    eraNumber,

    async close() {
      fileHandles.delete(fh.fd);
      await fh.close();
    },

    async validate(config: ChainForkConfig): Promise<void> {
      await validateEraFile(fh.fd, eraNumber, config);
    },

    async createIndex(): Promise<EraIndex> {
      // Read the entire file to extract the slot index
      const stats = await fh.stat();
      const buffer = new Uint8Array(stats.size);
      await fh.read(buffer, 0, stats.size, 0);

      // Get the block slot index from the era file
      const {blockSlotIndex} = getEraIndexes(buffer, eraNumber);

      if (!blockSlotIndex) {
        // Genesis era (era 0) has no block index
        return {
          startSlot: 0,
          indices: [],
        };
      }

      return {
        startSlot: blockSlotIndex.startSlot,
        indices: blockSlotIndex.offsets,
      };
    },
  };

  return eraFile;
}

/**
 * Helper to read entry at a specific offset from an open file handle.
 * Reads header first to determine data length, then reads the complete entry.
 */
async function readEntryFromFile(fh: FileHandle, offset: number): Promise<E2StoreEntry> {
  // Read header (8 bytes)
  const header = new Uint8Array(E2STORE_HEADER_SIZE);
  await fh.read(header, 0, E2STORE_HEADER_SIZE, offset);

  // Parse length from header
  const lengthView = new DataView(header.buffer, header.byteOffset + 2, 4);
  const dataLength = lengthView.getUint32(0, true);

  // Read complete entry (header + data)
  const fullEntry = new Uint8Array(E2STORE_HEADER_SIZE + dataLength);
  await fh.read(fullEntry, 0, fullEntry.length, offset);

  return readEntry(fullEntry);
}

/** Compress data using snappy framing */
async function compressSnappyFramed(data: Uint8Array): Promise<Uint8Array> {
  const buffers: Buffer[] = [];
  for await (const chunk of encodeSnappy(Buffer.from(data.buffer, data.byteOffset, data.byteLength))) {
    buffers.push(chunk);
  }
  const total = buffers.reduce((n, b) => n + b.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const b of buffers) {
    out.set(b, p);
    p += b.length;
  }
  return out;
}

// WeakMap to track FileHandle for each EraFile by fd
const fileHandles = new Map<number, FileHandle>();

/** Helper to get file handle from fd */
function getFileHandle(fd: number): FileHandle {
  const fh = fileHandles.get(fd);
  if (!fh) {
    throw new Error(`No FileHandle found for fd ${fd}`);
  }
  return fh;
}

/**
 * Get the state offset from the era file.
 * Reads only the necessary parts of the file to locate the state index.
 */
async function getStateOffset(fh: FileHandle, eraNumber: number): Promise<number> {
  // For now, read entire file to get indexes
  const stats = await fh.stat();
  const buffer = new Uint8Array(stats.size);
  await fh.read(buffer, 0, stats.size, 0);

  const {stateSlotIndex} = getEraIndexes(buffer, eraNumber);
  const offset = stateSlotIndex.offsets[0];
  if (!offset) throw new Error("No BeaconState in this era");

  return offset;
}

/**
 * Validate an era file for format correctness, era range, network correctness, and signatures.
 */
async function validateEraFile(fd: number, eraNumber: number, config: ChainForkConfig): Promise<void> {
  const fh = getFileHandle(fd);
  const stats = await fh.stat();
  const buffer = new Uint8Array(stats.size);
  await fh.read(buffer, 0, stats.size, 0);

  // Validate e2s format and era range
  const {stateSlotIndex, blockSlotIndex} = getEraIndexes(buffer, eraNumber);

  // Validate state
  const stateOffset = stateSlotIndex.offsets[0];
  if (!stateOffset) throw new Error("No BeaconState in era file");

  const stateEntry = readEntry(buffer.subarray(stateOffset));
  if (stateEntry.type !== E2StoreEntryType.CompressedBeaconState) {
    throw new Error(`Expected CompressedBeaconState, got ${stateEntry.type}`);
  }

  const state = decompressBeaconState(stateEntry.data, eraNumber, config);
  const expectedStateSlot = eraNumber * SLOTS_PER_HISTORICAL_ROOT;
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
      const block = decompressSignedBeaconBlock(blockEntry.data, slot, config);

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
    const fh = getFileHandle(this.era.fd);
    const offset = await getStateOffset(fh, this.era.eraNumber);
    const entry = await readEntryFromFile(fh, offset);

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

    const fh = getFileHandle(this.era.fd);
    const entry = await readEntryFromFile(fh, fileOffset);
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
    const fh = getFileHandle(this.era.fd);
    const stats = await fh.stat();
    const buffer = new Uint8Array(stats.size);
    await fh.read(buffer, 0, stats.size, 0);

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
    const fh = getFileHandle(this.era.fd);
    await fh.write(eraBytes, 0, eraBytes.length, 0);

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
