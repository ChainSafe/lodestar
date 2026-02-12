/**
 * `.dcol` binary format for multi-column data column files.
 *
 * Header layout (149 bytes):
 *   [version:     1B]
 *   [columnSize:  4B BE]  — size of each serialized column sidecar (fixed per block)
 *   [bitmap:     16B]     — 128-bit bitmap of which columns are present
 *   [blockRoot:  32B]
 *   [slot:        8B BE]
 *   [reserved:   88B]     — zero-filled, for future use
 *
 * Body: columns packed sequentially in bitmap order (no gaps).
 * To read column `i`: check bit `i` in bitmap, then offset = HEADER_SIZE + popcount(bitmap, 0..i-1) * columnSize
 */

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
  columnSize: number;
  bitmap: Uint8Array;
  blockRoot: Uint8Array;
  slot: number;
}

export function encodeDcolHeader(header: DcolHeader): Uint8Array {
  const buf = new Uint8Array(DCOL_HEADER_SIZE);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  buf[0] = header.version;
  view.setUint32(1, header.columnSize, false); // BE
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

  const columnSize = view.getUint32(1, false); // BE
  const bitmap = data.slice(BITMAP_OFFSET, BITMAP_OFFSET + BITMAP_BYTES);
  const blockRoot = data.slice(BLOCK_ROOT_OFFSET, BLOCK_ROOT_OFFSET + 32);

  const hi = view.getUint32(SLOT_OFFSET, false);
  const lo = view.getUint32(SLOT_OFFSET + 4, false);
  const slot = hi * 0x100000000 + lo;

  return {version, columnSize, bitmap, blockRoot, slot};
}

// --- Column offset ---

/** Get the byte offset for column `index` in a dcol file, or -1 if not present. */
export function getColumnOffset(bitmap: Uint8Array, columnSize: number, index: number): number {
  if (!getBit(bitmap, index)) return -1;
  return DCOL_HEADER_SIZE + popcount(bitmap, index) * columnSize;
}

// --- Full file encode/decode ---

/**
 * Encode a complete dcol file from columns.
 * All columns must have the same serialized size.
 */
export function encodeDcolFile(
  blockRoot: Uint8Array,
  slot: number,
  columns: {index: number; data: Uint8Array}[]
): Uint8Array {
  if (columns.length === 0) {
    throw new Error("Cannot encode dcol file with zero columns");
  }

  const columnSize = columns[0].data.length;
  const bitmap = new Uint8Array(BITMAP_BYTES);

  // Sort by index for deterministic ordering
  const sorted = [...columns].sort((a, b) => a.index - b.index);

  for (const col of sorted) {
    if (col.data.length !== columnSize) {
      throw new Error(`Column size mismatch: ${col.data.length} !== ${columnSize}`);
    }
    setBit(bitmap, col.index);
  }

  const header = encodeDcolHeader({version: DCOL_VERSION, columnSize, bitmap, blockRoot, slot});
  const body = new Uint8Array(DCOL_HEADER_SIZE + sorted.length * columnSize);
  body.set(header, 0);

  let offset = DCOL_HEADER_SIZE;
  for (const col of sorted) {
    body.set(col.data, offset);
    offset += columnSize;
  }

  return body;
}

/**
 * Merge new columns into an existing dcol file buffer.
 * Returns a new buffer with the merged columns.
 */
export function mergeDcolColumns(existing: Uint8Array, newColumns: {index: number; data: Uint8Array}[]): Uint8Array {
  const header = parseDcolHeader(existing);
  const {bitmap, columnSize} = header;

  // Collect existing columns
  const allColumns: Map<number, Uint8Array> = new Map();

  for (let i = 0; i < 128; i++) {
    if (getBit(bitmap, i)) {
      const offset = getColumnOffset(bitmap, columnSize, i);
      allColumns.set(i, existing.slice(offset, offset + columnSize));
    }
  }

  // Add/overwrite with new columns
  for (const col of newColumns) {
    if (col.data.length !== columnSize && allColumns.size > 0) {
      throw new Error(`Column size mismatch: ${col.data.length} !== ${columnSize}`);
    }
    allColumns.set(col.index, col.data);
  }

  // Re-encode
  const cols = Array.from(allColumns.entries())
    .sort(([a], [b]) => a - b)
    .map(([index, data]) => ({index, data}));

  return encodeDcolFile(header.blockRoot, header.slot, cols);
}
