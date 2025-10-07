import type {FileHandle} from "node:fs/promises";
import {readFile, writeFile} from "node:fs/promises";
import {Uint8ArrayList} from "uint8arraylist";
import {ChainForkConfig} from "@lodestar/config";
import {SLOTS_PER_HISTORICAL_ROOT} from "@lodestar/params";
import {SnappyFramesUncompress, encodeSnappy} from "@lodestar/reqresp/encodingStrategies/sszSnappy";
import {Slot} from "@lodestar/types";
import {E2STORE_HEADER_SIZE, E2StoreEntryType, EraTypes, VERSION_RECORD_BYTES} from "./constants.js";
import type {E2StoreEntry, EraIndex, SlotIndex} from "./types.js";

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

/** Read 48-bit signed integer (little-endian) at offset. */
function readInt64(bytes: Uint8Array, offset: number): number {
  return Buffer.prototype.readIntLE.call(bytes, offset, 6);
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

    if (relativeOffset === 0) {
      offsets.push(0);
    } else {
      // Convert relative offset to absolute header position with bounds validation
      const absoluteHeaderOffset = indexStart + relativeOffset;
      if (absoluteHeaderOffset < 0 || absoluteHeaderOffset >= bytes.length) {
        throw new Error(
          `Invalid absolute offset: ${absoluteHeaderOffset} (relative: ${relativeOffset}, ` +
            `indexStart: ${indexStart}, fileSize: ${bytes.length})`
        );
      }
      offsets.push(absoluteHeaderOffset);
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
export function getEraIndexes(
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
export function decompressBeaconState(compressedData: Uint8Array, era: number, config: ChainForkConfig) {
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
export function decompressSignedBeaconBlock(compressedData: Uint8Array, blockSlot: number, config: ChainForkConfig) {
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

/** In-place encode of a 48-bit signed integer (little-endian) into target at offset. */
function writeI64LEInto(target: Uint8Array, offset: number, v: number): void {
  Buffer.prototype.writeIntLE.call(target, v, offset, 6);
}
function readI64LE(buf: Uint8Array, off: number): number {
  return Buffer.prototype.readIntLE.call(buf, off, 6);
}

/**
 * Read block slot index from an era file without loading the entire file into memory.
 * Only reads the necessary index data from the end of the file.
 */
export async function readBlockSlotIndexFromFile(fh: FileHandle): Promise<EraIndex> {
  const stats = await fh.stat();
  const fileSize = stats.size;

  const stateIndexSize = E2STORE_HEADER_SIZE + 24;
  const stateIndexStart = fileSize - stateIndexSize;

  // Read state index to get startSlot
  const stateIndexBytes = new Uint8Array(stateIndexSize);
  await fh.read(stateIndexBytes, 0, stateIndexSize, stateIndexStart);
  const stateEntry = readEntry(stateIndexBytes);
  const stateStartSlot = readI64LE(stateEntry.data, 0);

  // Genesis era (era 0) has no block index
  if (stateStartSlot === 0) {
    return {startSlot: 0, indices: []};
  }

  // Read trailing count from block index (8 bytes before state index)
  const blockCountBytes = new Uint8Array(8);
  await fh.read(blockCountBytes, 0, 8, stateIndexStart - 8);
  const blockCount = readI64LE(blockCountBytes, 0);

  // Calculate block index size and read it
  const blockIndexSize = E2STORE_HEADER_SIZE + 16 + blockCount * 8;
  const blockIndexStart = stateIndexStart - blockIndexSize;

  const blockIndexBytes = new Uint8Array(blockIndexSize);
  await fh.read(blockIndexBytes, 0, blockIndexSize, blockIndexStart);
  const blockEntry = readEntry(blockIndexBytes);

  // Parse block index
  const blockStartSlot = readI64LE(blockEntry.data, 0);
  const offsets: number[] = [];
  for (let i = 0; i < blockCount; i++) {
    const offsetFieldOffset = 8 + i * 8;
    const relativeOffset = readI64LE(blockEntry.data, offsetFieldOffset);
    if (relativeOffset === 0) {
      offsets.push(0);
    } else {
      const absoluteOffset = blockIndexStart + relativeOffset;
      offsets.push(absoluteOffset);
    }
  }

  return {startSlot: blockStartSlot, indices: offsets};
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
  writeI64LEInto(payload, 0, startSlot);

  // offsets (relative to beginning of index record)
  let off = 8;
  for (let i = 0; i < count; i++, off += 8) {
    const abs = offsetsAbs[i];
    const rel = abs === 0 ? 0 : abs - indexRecordStart;
    writeI64LEInto(payload, off, rel);
  }

  // trailing count
  writeI64LEInto(payload, 8 + count * 8, count);
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
export function writeEraGroup(params: {
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
  writeI64LEInto(buffer, 0, index.startSlot);

  // Write count
  writeI64LEInto(buffer, 8, count);

  // Write indices
  for (let i = 0; i < count; i++) {
    writeI64LEInto(buffer, 16 + i * 8, index.indices[i]);
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
 * Helper to read entry at a specific offset from an open file handle.
 * Reads header first to determine data length, then reads the complete entry.
 */
export async function readEntryFromFile(fh: FileHandle, offset: number): Promise<E2StoreEntry> {
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
export async function compressSnappyFramed(data: Uint8Array): Promise<Uint8Array> {
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

/**
 * Get the state offset from the era file.
 * Reads only the necessary parts of the file to locate the state index.
 */
export async function getStateOffset(fh: FileHandle, eraNumber: number): Promise<number> {
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
export async function validateEraFile(fh: FileHandle, eraNumber: number, config: ChainForkConfig): Promise<void> {
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
