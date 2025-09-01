import {ChainForkConfig} from "@lodestar/config";
import {SLOTS_PER_HISTORICAL_ROOT} from "@lodestar/params";
import {Uint8ArrayList} from "uint8arraylist";
import {SnappyFramesUncompress} from "../../reqresp/lib/encodingStrategies/sszSnappy/snappyFrames/uncompress.js";
import {E2STORE_HEADER_SIZE, E2StoreEntryType, EraTypes} from "./constants.js";
import type {E2StoreEntry, SlotIndex} from "./types.js";

/**
 * Read an e2Store entry (header + data)
 * Header: 2 bytes type + 4 bytes length (LE) + 2 bytes reserved (must be 0)
 */
export function readEntry(bytes: Uint8Array): E2StoreEntry {
  if (bytes.length < E2STORE_HEADER_SIZE) {
    throw new Error(`Buffer too small for E2Store header: need ${E2STORE_HEADER_SIZE} bytes, got ${bytes.length}`);
  }

  // validate entry type from first 2 bytes
  const typeBytes = bytes.slice(0, 2);
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
  const data = bytes.slice(dataStartOffset, dataStartOffset + length);

  return {type, data};
}

/**
 * Read 64-bit little-endian integer
 */
function readInt64(bytes: Uint8Array, offset: number): bigint {
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 8);
  return view.getBigInt64(0, true);
}

/**
 * Read slot index from end of era file with validation
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
  const entry = readEntry(bytes.slice(indexStart));
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
      // Convert relative offset to absolute position with bounds validation
      const indexHeaderStart = BigInt(indexStart);
      const absoluteOffset = indexHeaderStart + relativeOffset;
      if (absoluteOffset < 0n || absoluteOffset >= BigInt(bytes.length)) {
        throw new Error(
          `Invalid absolute offset: ${absoluteOffset} (relative: ${relativeOffset}, ` +
            `indexStart: ${indexStart}, fileSize: ${bytes.length})`
        );
      }
      offsets.push(Number(absoluteOffset));
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
 * Gets both slot indices from era file with validation and alignment checks
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
    const blockIndexBytes = eraBytes.slice(0, stateSlotIndex.recordStart);
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

/**
 * Decompresses snappy-framed data using Lodestar's spec-compliant decompressor
 */
function decompressFrames(compressedData: Uint8Array): Uint8Array {
  const decompressor = new SnappyFramesUncompress();

  const input = new Uint8ArrayList(compressedData);
  const result = decompressor.uncompress(input);

  if (result === null) {
    throw new Error("Snappy decompression failed - no data returned");
  }

  return result.subarray();
}

/**
 * Decompresses and deserializes a beacon state using the correct fork for the era
 */
export function decompressBeaconState(compressedData: Uint8Array, era: number, config: ChainForkConfig) {
  const uncompressed = decompressFrames(compressedData);

  const stateSlot = era * SLOTS_PER_HISTORICAL_ROOT;
  const forkTypes = config.getForkTypes(stateSlot);

  try {
    return forkTypes.BeaconState.deserialize(uncompressed);
  } catch (error) {
    throw new Error(`Failed to deserialize BeaconState for era ${era}, slot ${stateSlot}: ${error}`);
  }
}

/**
 * Decompresses and deserializes a signed beacon block using the correct fork for the block slot
 */
export function decompressSignedBeaconBlock(compressedData: Uint8Array, blockSlot: number, config: ChainForkConfig) {
  const uncompressed = decompressFrames(compressedData);

  const forkTypes = config.getForkTypes(blockSlot);

  try {
    return forkTypes.SignedBeaconBlock.deserialize(uncompressed);
  } catch (error) {
    throw new Error(`Failed to deserialize SignedBeaconBlock for slot ${blockSlot}: ${error}`);
  }
}

/**
 * Read & decode the single era BeaconState from an .era file.
 */
export function readBeaconStateFromEra(eraBytes: Uint8Array, config: ChainForkConfig, expectedEra?: number) {
  const {stateSlotIndex} = getEraIndexes(eraBytes, expectedEra);

  const offset = stateSlotIndex.offsets[0];
  if (!offset) throw new Error("No BeaconState in this era (stateSlotIndex offset is 0)");

  const entry = readEntry(eraBytes.slice(offset));
  if (entry.type !== E2StoreEntryType.CompressedBeaconState) {
    throw new Error(`Expected CompressedBeaconState at 0x${offset.toString(16)}, got ${entry.type}`);
  }

  const era = expectedEra ?? Math.floor(stateSlotIndex.startSlot / SLOTS_PER_HISTORICAL_ROOT);
  return decompressBeaconState(entry.data, era, config);
}

/**
 * Read & decode a SignedBeaconBlock at a given offset inside the era’s block index.
 */
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

  const entry = readEntry(eraBytes.slice(abs));
  if (entry.type !== E2StoreEntryType.CompressedSignedBeaconBlock) {
    throw new Error(`Expected CompressedSignedBeaconBlock at 0x${abs.toString(16)}, got ${entry.type}`);
  }

  const slot = blockSlotIndex.startSlot + blockOffset;
  return decompressSignedBeaconBlock(entry.data, slot, config);
}

/**
 * Iterate all SignedBeaconBlocks in an era (skips empty slots).
 */
export function* readBlocksFromEra(eraBytes: Uint8Array, config: ChainForkConfig, expectedEra?: number) {
  const {blockSlotIndex} = getEraIndexes(eraBytes, expectedEra);
  if (!blockSlotIndex) return;

  for (let i = 0; i < blockSlotIndex.offsets.length; i++) {
    const abs = blockSlotIndex.offsets[i];
    if (!abs) continue;

    const entry = readEntry(eraBytes.slice(abs));
    if (entry.type !== E2StoreEntryType.CompressedSignedBeaconBlock) continue;

    const slot = blockSlotIndex.startSlot + i;
    yield decompressSignedBeaconBlock(entry.data, slot, config);
  }
}
