import type {FileHandle} from "node:fs/promises";
import {Slot} from "@lodestar/types";
import {readInt48, readUint16, readUint32, writeInt48, writeUint16, writeUint32} from "./util.ts";

/**
 * Known entry types in an E2Store (.e2s) file along with their exact 2-byte codes.
 */
export enum EntryType {
  Empty = 0,
  CompressedSignedBeaconBlock = 1,
  CompressedBeaconState = 2,
  Version = 0x65 | (0x32 << 8), // "e2" in ASCII
  SlotIndex = 0x69 | (0x32 << 8),
}
/**
 * Logical, parsed entry from an E2Store file.
 */
export interface Entry {
  type: EntryType;
  data: Uint8Array;
}

/**
 * Maps slots to file positions in an era file.
 * - Block index: count = SLOTS_PER_HISTORICAL_ROOT, maps slots to blocks
 * - State index: count = 1, points to the era state
 * - Zero offset = empty slot (no block)
 */
export interface SlotIndex {
  type: EntryType.SlotIndex;
  /** First slot covered by this index (era * SLOTS_PER_HISTORICAL_ROOT) */
  startSlot: Slot;
  /** File positions where data can be found. Length varies by index type. */
  offsets: number[];
  /** File position where this index record starts */
  recordStart: number;
}

/**
 * The complete version record (8 bytes total).
 */
export const VERSION_RECORD_BYTES = new Uint8Array([0x65, 0x32, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);

/**
 * E2Store header size in bytes
 */
export const E2STORE_HEADER_SIZE = 8;

/**
 * Helper to read entry at a specific offset from an open file handle.
 * Reads header first to determine data length, then reads the complete entry.
 */
export async function readEntry(fh: FileHandle, offset: number): Promise<Entry> {
  // Read header (8 bytes)
  const header = new Uint8Array(E2STORE_HEADER_SIZE);
  await fh.read(header, 0, E2STORE_HEADER_SIZE, offset);
  const {type, length} = parseEntryHeader(header);

  // Read entry payload/data
  const data = new Uint8Array(length);
  await fh.read(data, 0, data.length, offset + E2STORE_HEADER_SIZE);

  return {type, data};
}

/**
 * Read an e2Store entry (header + data)
 * Header: 2 bytes type + 4 bytes length (LE) + 2 bytes reserved (must be 0)
 */
export function parseEntryHeader(header: Uint8Array): {type: EntryType; length: number} {
  if (header.length < E2STORE_HEADER_SIZE) {
    throw new Error(`Buffer too small for E2Store header: need ${E2STORE_HEADER_SIZE} bytes, got ${header.length}`);
  }

  // validate entry type from first 2 bytes
  const typeCode = readUint16(header, 0);
  if (!(typeCode in EntryType)) {
    throw new Error(`Unknown E2Store entry type: 0x${typeCode.toString(16)}`);
  }
  const type = typeCode as EntryType;

  // Parse data length from next 4 bytes (offset 2, little endian)
  const length = readUint32(header, 2);

  // Validate reserved bytes are zero (offset 6-7)
  const reserved = readUint16(header, 6);
  if (reserved !== 0) {
    throw new Error(`E2Store reserved bytes must be zero, got: ${reserved}`);
  }

  return {type, length};
}

export async function readVersion(fh: FileHandle, offset: number): Promise<void> {
  const versionHeader = new Uint8Array(E2STORE_HEADER_SIZE);
  await fh.read(versionHeader, 0, E2STORE_HEADER_SIZE, offset);
  if (Buffer.compare(versionHeader, VERSION_RECORD_BYTES) !== 0) {
    throw new Error("Invalid E2Store version record");
  }
}

/**
 * Read a SlotIndex from a file handle.
 */
export async function readSlotIndex(fh: FileHandle, offset: number): Promise<SlotIndex> {
  const recordEnd = offset;
  const countBuffer = new Uint8Array(8);
  await fh.read(countBuffer, 0, 8, recordEnd - 8);
  const count = readInt48(countBuffer, 0);

  const recordStart = recordEnd - (8 * count + 24);

  // Validate index position is within file bounds
  if (recordStart < 0) {
    throw new Error(`SlotIndex position ${recordStart} is invalid - file too small for count=${count}`);
  }

  // Read and validate the slot index entry
  const entry = await readEntry(fh, recordStart);
  if (entry.type !== EntryType.SlotIndex) {
    throw new Error(`Expected SlotIndex entry, got ${entry.type}`);
  }

  // Size: startSlot(8) + offsets(count*8) + count(8) = count*8 + 16
  const expectedSize = 8 * count + 16;
  if (entry.data.length !== expectedSize) {
    throw new Error(`SlotIndex payload size must be exactly ${expectedSize} bytes, got ${entry.data.length}`);
  }

  // Parse start slot from payload
  const startSlot = readInt48(entry.data, 0);

  const offsets: number[] = [];
  for (let i = 0; i < count; i++) {
    offsets.push(readInt48(entry.data, 8 * i + 8));
  }

  return {
    type: EntryType.SlotIndex,
    startSlot,
    offsets,
    recordStart,
  };
}

/**
 * Write a single E2Store TLV entry (header + payload)
 * Header layout: type[2] | length u32 LE | reserved u16(=0)
 */
export async function writeEntry(fh: FileHandle, offset: number, type: EntryType, payload: Uint8Array): Promise<void> {
  const header = new Uint8Array(E2STORE_HEADER_SIZE);
  writeUint16(header, 0, type); // type (2 bytes)
  writeUint32(header, 2, payload.length); // length (4 bytes)
  // reserved bytes (6-7) remain 0
  await fh.writev([header, payload], offset);
}

export async function writeVersion(fh: FileHandle, offset: number): Promise<void> {
  await fh.write(VERSION_RECORD_BYTES, 0, VERSION_RECORD_BYTES.length, offset);
}

export function serializeSlotIndex(slotIndex: SlotIndex): Uint8Array {
  const count = slotIndex.offsets.length;
  const payload = new Uint8Array(count * 8 + 16);

  // startSlot
  writeInt48(payload, 0, slotIndex.startSlot);

  // offsets
  let off = 8;
  for (let i = 0; i < count; i++, off += 8) {
    writeInt48(payload, off, slotIndex.offsets[i]);
  }

  // trailing count
  writeInt48(payload, 8 + count * 8, count);
  return payload;
}
