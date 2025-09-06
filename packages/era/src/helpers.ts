import {ChainForkConfig} from "@lodestar/config";
import {SLOTS_PER_EPOCH, SLOTS_PER_HISTORICAL_ROOT} from "@lodestar/params";
import {Uint8ArrayList} from "uint8arraylist";
import {SnappyFramesUncompress} from "../../reqresp/lib/encodingStrategies/sszSnappy/snappyFrames/uncompress.js";
import {E2STORE_HEADER_SIZE, E2StoreEntryType, EraTypes, VERSION_RECORD_BYTES} from "./constants.js";
import type {E2StoreEntry, SlotIndex} from "./types.js";

/**
 * Cache fork types by epoch. Fork transitions occur at epoch boundaries,
 * so caching by epoch is safe and efficient.
 */
type ForkTypes = ReturnType<ChainForkConfig["getForkTypes"]>;
const forkTypesByEpoch = new Map<number, ForkTypes>();
function getForkTypesCached(config: ChainForkConfig, slot: number): ForkTypes {
  const epoch = Math.floor(slot / SLOTS_PER_EPOCH);
  let types = forkTypesByEpoch.get(epoch);
  if (!types) {
    types = config.getForkTypes(slot);
    forkTypesByEpoch.set(epoch, types);
  }
  return types;
}

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
export function readSlotIndex(bytes: Uint8Array, expectedType: "state" | "block"): SlotIndex {
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

  // Validate payload size matches specification
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

  // Validate trailing count matches EOF count
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

/** Decompress snappy-framed data using Lodestar's spec-compliant decompressor. */
function decompressFrames(compressedData: Uint8Array): Uint8Array {
  const decompressor = new SnappyFramesUncompress();

  const input = new Uint8ArrayList(compressedData);
  const result = decompressor.uncompress(input);

  if (result === null) {
    throw new Error("Snappy decompression failed - no data returned");
  }

  return result.subarray();
}

/** Decompress and deserialize a BeaconState using the appropriate fork for the era. */
export function decompressBeaconState(
  compressedData: Uint8Array,
  era: number,
  config: ChainForkConfig,
  forkTypes?: ForkTypes
) {
  const uncompressed = decompressFrames(compressedData);

  const stateSlot = era * SLOTS_PER_HISTORICAL_ROOT;
  const types = forkTypes ?? getForkTypesCached(config, stateSlot);

  try {
    return types.BeaconState.deserialize(uncompressed);
  } catch (error) {
    throw new Error(`Failed to deserialize BeaconState for era ${era}, slot ${stateSlot}: ${error}`);
  }
}

/** Decompress and deserialize a SignedBeaconBlock using the fork for the given slot. */
export function decompressSignedBeaconBlock(
  compressedData: Uint8Array,
  blockSlot: number,
  config: ChainForkConfig,
  forkTypes?: ForkTypes
) {
  const uncompressed = decompressFrames(compressedData);

  const types = forkTypes ?? getForkTypesCached(config, blockSlot);

  try {
    return types.SignedBeaconBlock.deserialize(uncompressed);
  } catch (error) {
    throw new Error(`Failed to deserialize SignedBeaconBlock for slot ${blockSlot}: ${error}`);
  }
}

export type SnappyFramedCompress = (ssz: Uint8Array) => Uint8Array;

/**
 * Write a single E2Store TLV entry (header + payload)
 * Header layout: type[2] | length u32 LE | reserved u16(=0)
 */
export function writeEntry(type2: Uint8Array, payload: Uint8Array): Uint8Array {
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

/** Encode a 64-bit signed integer (little-endian) into a new Uint8Array. */
export function writeI64LE(v: bigint): Uint8Array {
  // Allocates a single 8-byte output but reuses the shared DataView for encoding
  scratch64View.setBigInt64(0, v, true);
  const out = new Uint8Array(8);
  out.set(scratch64Bytes);
  return out;
}

/** In-place encode of a 64-bit signed integer (little-endian) into target at offset. */
function writeI64LEInto(target: Uint8Array, offset: number, v: bigint): void {
  scratch64View.setBigInt64(0, v, true);
  target.set(scratch64Bytes, offset);
}
export function readI64LE(buf: Uint8Array, off: number): bigint {
  const dv = new DataView(buf.buffer, buf.byteOffset + off, 8);
  return dv.getBigInt64(0, true);
}
/**
 * Build SlotIndex payload: startSlot | offsets[count] | count.
 * Offsets are i64 relative to the index record start (0 = missing).
 * Payload size = count*8 + 16 (header not included).
 */
export function buildSlotIndexData(
  startSlot: number,
  offsetsAbs: readonly number[],
  indexRecordStart: number
): Uint8Array {
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
export function writeCompressedBlock(ssz: Uint8Array, snappyFramed: SnappyFramedCompress): Uint8Array {
  const framed = snappyFramed(ssz);
  return writeEntry(EraTypes[E2StoreEntryType.CompressedSignedBeaconBlock], framed);
}

export function writeCompressedState(ssz: Uint8Array, snappyFramed: SnappyFramedCompress): Uint8Array {
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

/** Write an ERA file from one or more groups (concatenated). */
export function writeEraFile(
  groups: Array<{
    era: number;
    slotsPerHistoricalRoot: number;
    snappyFramed: SnappyFramedCompress;
    blocksBySlot: Map<number, Uint8Array>;
    stateSlot: number;
    stateSSZ: Uint8Array;
  }>
): Uint8Array {
  const chunks: Uint8Array[] = [];
  for (const g of groups) {
    chunks.push(writeEraGroup(g));
  }
  return concat(chunks);
}

/** Read and decode the BeaconState from an .era file (single era). */
export function readBeaconStateFromEra(eraBytes: Uint8Array, config: ChainForkConfig, expectedEra?: number) {
  const {stateSlotIndex} = getEraIndexes(eraBytes, expectedEra);

  const offset = stateSlotIndex.offsets[0];
  if (!offset) throw new Error("No BeaconState in this era (stateSlotIndex offset is 0)");

  const entry = readEntry(eraBytes.subarray(offset));
  if (entry.type !== E2StoreEntryType.CompressedBeaconState) {
    throw new Error(`Expected CompressedBeaconState at 0x${offset.toString(16)}, got ${entry.type}`);
  }

  const era = expectedEra ?? Math.floor(stateSlotIndex.startSlot / SLOTS_PER_HISTORICAL_ROOT);
  const types = getForkTypesCached(config, stateSlotIndex.startSlot);
  return decompressBeaconState(entry.data, era, config, types);
}

/** Read and decode a SignedBeaconBlock at the given offset in the block index. */
export function readBeaconBlockFromEra(
  eraBytes: Uint8Array,
  blockOffset: number,
  config: ChainForkConfig,
  expectedEra?: number
) {
  if (blockOffset < 0 || blockOffset >= SLOTS_PER_HISTORICAL_ROOT) {
    throw new RangeError(`blockOffset out of range: ${blockOffset}`);
  }

  const {blockSlotIndex} = getEraIndexes(eraBytes, expectedEra);
  if (!blockSlotIndex) throw new Error("No block SlotIndex present in this era file");

  const abs = blockSlotIndex.offsets[blockOffset];
  if (!abs) throw new Error(`No block at offset ${blockOffset} (empty slot)`);

  const entry = readEntry(eraBytes.subarray(abs));
  if (entry.type !== E2StoreEntryType.CompressedSignedBeaconBlock) {
    throw new Error(`Expected CompressedSignedBeaconBlock at 0x${abs.toString(16)}, got ${entry.type}`);
  }

  const slot = blockSlotIndex.startSlot + blockOffset;
  const types = getForkTypesCached(config, slot);
  return decompressSignedBeaconBlock(entry.data, slot, config, types);
}

/** Iterate all SignedBeaconBlocks in an era (skips empty slots). */
export function* readBlocksFromEra(eraBytes: Uint8Array, config: ChainForkConfig, expectedEra?: number) {
  const {blockSlotIndex} = getEraIndexes(eraBytes, expectedEra);
  if (!blockSlotIndex) return;

  for (let i = 0; i < blockSlotIndex.offsets.length; i++) {
    const abs = blockSlotIndex.offsets[i];
    if (!abs) continue;

    const entry = readEntry(eraBytes.subarray(abs));
    if (entry.type !== E2StoreEntryType.CompressedSignedBeaconBlock) continue;

    const slot = blockSlotIndex.startSlot + i;
    const types = getForkTypesCached(config, slot);
    yield decompressSignedBeaconBlock(entry.data, slot, config, types);
  }
}
