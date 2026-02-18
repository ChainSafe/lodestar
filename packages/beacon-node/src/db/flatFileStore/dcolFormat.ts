/**
 * `.dcol` binary format for multi-column data column files.
 *
 * Layout:
 *   HEADER (149 bytes):
 *     [version:     1B = 0x01]
 *     [_reserved:   4B]       — zero-filled
 *     [bitmap:     16B]       — 128-bit bitmap of which columns are present
 *     [blockRoot:  32B]
 *     [slot:        8B BE]
 *     [reserved:   88B]       — zero-filled, for future use
 *
 *   OFFSET TABLE ((N+1) * 4 bytes, where N = popcount(bitmap)):
 *     [offset_0:4B BE]   start of column 0's compressed data, relative to data region start
 *     [offset_1:4B BE]   ...
 *     [offset_N:4B BE]   end of last column = total data region size (sentinel)
 *
 *   DATA REGION:
 *     [snappy(column_0)][snappy(column_1)]...[snappy(column_N-1)]
 *
 * Each column is independently Snappy block-compressed. To read column at bitmap position `p`:
 *   dataStart = HEADER_SIZE + (N+1)*4
 *   colStart  = dataStart + offsets[p]
 *   colEnd    = dataStart + offsets[p+1]
 *   column    = snappy.uncompress(file[colStart:colEnd])
 */

import {compressSync} from "snappy";
import {uncompress} from "snappyjs";

export const DCOL_VERSION = 0x01;
export const DCOL_HEADER_SIZE = 149;
const BITMAP_BYTES = 16;
const BITMAP_OFFSET = 5;
const BLOCK_ROOT_OFFSET = 21;
const SLOT_OFFSET = 53;

// --- Bitmap helpers ---

/** Get bit `i` from a 16-byte Uint8Array bitmap (little-endian bit order within each byte). */
export function getBit(bitmap: Uint8Array, i: number): boolean {
  const byteIdx = Math.floor(i / 8);
  const bitIdx = i % 8;
  return (bitmap[byteIdx] & (1 << bitIdx)) !== 0;
}

/** Set bit `i` in a 16-byte Uint8Array bitmap. */
export function setBit(bitmap: Uint8Array, i: number): void {
  const byteIdx = Math.floor(i / 8);
  const bitIdx = i % 8;
  bitmap[byteIdx] |= 1 << bitIdx;
}

/** Count set bits in bitmap for positions 0..i-1 (exclusive of i). */
export function popcount(bitmap: Uint8Array, upTo: number): number {
  let count = 0;
  for (let j = 0; j < upTo; j++) {
    if (getBit(bitmap, j)) count++;
  }
  return count;
}

/** Count total set bits in bitmap. */
export function totalBits(bitmap: Uint8Array): number {
  let count = 0;
  for (let byteIdx = 0; byteIdx < BITMAP_BYTES; byteIdx++) {
    let b = bitmap[byteIdx];
    while (b) {
      count += b & 1;
      b >>= 1;
    }
  }
  return count;
}

// --- Header encode/decode ---

export interface DcolHeader {
  version: number;
  bitmap: Uint8Array;
  blockRoot: Uint8Array;
  slot: number;
}

export function encodeDcolHeader(header: DcolHeader): Uint8Array {
  const buf = new Uint8Array(DCOL_HEADER_SIZE);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  buf[0] = header.version;
  // bytes 1-4 reserved (zero)
  buf.set(header.bitmap, BITMAP_OFFSET);
  buf.set(header.blockRoot, BLOCK_ROOT_OFFSET);

  // Slot as 8-byte BE (JavaScript safe integer range is sufficient)
  const hi = Math.floor(header.slot / 0x100000000);
  const lo = header.slot >>> 0;
  view.setUint32(SLOT_OFFSET, hi, false);
  view.setUint32(SLOT_OFFSET + 4, lo, false);

  // reserved bytes are already zero
  return buf;
}

export function parseDcolHeader(data: Uint8Array): DcolHeader {
  if (data.length < DCOL_HEADER_SIZE) {
    throw new Error(`dcol file too small: ${data.length} < ${DCOL_HEADER_SIZE}`);
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  const version = data[0];
  if (version !== DCOL_VERSION) {
    throw new Error(`Unsupported dcol version: ${version}`);
  }

  const bitmap = Uint8Array.prototype.slice.call(data, BITMAP_OFFSET, BITMAP_OFFSET + BITMAP_BYTES) as Uint8Array;
  const blockRoot = Uint8Array.prototype.slice.call(data, BLOCK_ROOT_OFFSET, BLOCK_ROOT_OFFSET + 32) as Uint8Array;

  const hi = view.getUint32(SLOT_OFFSET, false);
  const lo = view.getUint32(SLOT_OFFSET + 4, false);
  const slot = hi * 0x100000000 + lo;

  return {version, bitmap, blockRoot, slot};
}

// --- Column read helpers ---

/**
 * Read a single column by its column index from a dcol file buffer.
 * Returns the uncompressed column data, or null if column is not present.
 */
export function readColumn(fileData: Uint8Array, header: DcolHeader, index: number): Uint8Array | null {
  if (!getBit(header.bitmap, index)) return null;

  const p = popcount(header.bitmap, index);
  const N = totalBits(header.bitmap);
  const tableStart = DCOL_HEADER_SIZE;
  const dataStart = tableStart + (N + 1) * 4;
  const tableView = new DataView(fileData.buffer, fileData.byteOffset, fileData.byteLength);

  const colStart = dataStart + tableView.getUint32(tableStart + p * 4, false);
  const colEnd = dataStart + tableView.getUint32(tableStart + (p + 1) * 4, false);
  const compressed = fileData.subarray(colStart, colEnd);

  return uncompress(compressed);
}

/**
 * Read all columns from a dcol file buffer.
 * Returns an array of {index, data} for each present column.
 */
export function readAllColumns(fileData: Uint8Array, header: DcolHeader): {index: number; data: Uint8Array}[] {
  const result: {index: number; data: Uint8Array}[] = [];
  const N = totalBits(header.bitmap);

  const tableStart = DCOL_HEADER_SIZE;
  const dataStart = tableStart + (N + 1) * 4;
  const tableView = new DataView(fileData.buffer, fileData.byteOffset, fileData.byteLength);

  let pos = 0;
  for (let i = 0; i < 128; i++) {
    if (getBit(header.bitmap, i)) {
      const colStart = dataStart + tableView.getUint32(tableStart + pos * 4, false);
      const colEnd = dataStart + tableView.getUint32(tableStart + (pos + 1) * 4, false);
      const compressed = fileData.subarray(colStart, colEnd);
      result.push({index: i, data: uncompress(compressed)});
      pos++;
    }
  }

  return result;
}

// --- Targeted read helpers (for fd.read()-based access) ---

export interface ColumnByteRange {
  /** Absolute file offset to start reading */
  offset: number;
  /** Number of compressed bytes to read */
  length: number;
}

/**
 * Compute the file byte range for a specific column, using the header
 * and offset table bytes. Returns null if column is absent.
 */
export function getColumnByteRange(
  header: DcolHeader,
  offsetTable: Uint8Array,
  index: number
): ColumnByteRange | null {
  if (!getBit(header.bitmap, index)) return null;

  const p = popcount(header.bitmap, index);
  const N = totalBits(header.bitmap);
  const dataStart = DCOL_HEADER_SIZE + (N + 1) * 4;
  const view = new DataView(offsetTable.buffer, offsetTable.byteOffset, offsetTable.byteLength);

  const colStart = view.getUint32(p * 4, false);
  const colEnd = view.getUint32((p + 1) * 4, false);

  return {
    offset: dataStart + colStart,
    length: colEnd - colStart,
  };
}

/** Size of the offset table in bytes for N present columns. */
export function offsetTableSize(N: number): number {
  return (N + 1) * 4;
}

// --- Full file encode/decode ---

/**
 * Encode a complete dcol file from columns.
 * Each column is independently Snappy block-compressed.
 */
export function encodeDcolFile(
  blockRoot: Uint8Array,
  slot: number,
  columns: {index: number; data: Uint8Array}[]
): Uint8Array {
  if (columns.length === 0) {
    throw new Error("Cannot encode dcol file with zero columns");
  }

  const bitmap = new Uint8Array(BITMAP_BYTES);

  // Sort by index for deterministic ordering
  const sorted = [...columns].sort((a, b) => a.index - b.index);

  for (const col of sorted) {
    setBit(bitmap, col.index);
  }

  // Compress each column
  const compressed: Uint8Array[] = [];
  for (const col of sorted) {
    compressed.push(compressSync(Buffer.from(col.data.buffer, col.data.byteOffset, col.data.byteLength)));
  }

  // Build offset table
  const N = sorted.length;
  const oTableSize = (N + 1) * 4;
  const offsets = new Uint8Array(oTableSize);
  const offsetView = new DataView(offsets.buffer, offsets.byteOffset, offsets.byteLength);

  let cumulative = 0;
  for (let i = 0; i < N; i++) {
    offsetView.setUint32(i * 4, cumulative, false); // BE
    cumulative += compressed[i].length;
  }
  offsetView.setUint32(N * 4, cumulative, false); // sentinel: end of last column

  // Assemble: header + offset table + compressed data
  const header = encodeDcolHeader({version: DCOL_VERSION, bitmap, blockRoot, slot});
  const totalSize = DCOL_HEADER_SIZE + oTableSize + cumulative;
  const result = new Uint8Array(totalSize);

  result.set(header, 0);
  result.set(offsets, DCOL_HEADER_SIZE);

  let dataOffset = DCOL_HEADER_SIZE + oTableSize;
  for (const chunk of compressed) {
    result.set(chunk, dataOffset);
    dataOffset += chunk.length;
  }

  return result;
}

/**
 * Merge new columns into an existing dcol file buffer.
 */
export function mergeDcolColumns(existing: Uint8Array, newColumns: {index: number; data: Uint8Array}[]): Uint8Array {
  const header = parseDcolHeader(existing);

  const existingCols = readAllColumns(existing, header);

  const allColumns: Map<number, Uint8Array> = new Map();
  for (const col of existingCols) {
    allColumns.set(col.index, col.data);
  }

  for (const col of newColumns) {
    allColumns.set(col.index, col.data);
  }

  const cols = Array.from(allColumns.entries())
    .sort(([a], [b]) => a - b)
    .map(([index, data]) => ({index, data}));

  return encodeDcolFile(header.blockRoot, header.slot, cols);
}
