import fs from "node:fs";
import path from "node:path";
import {RootHex, Slot} from "@lodestar/types";
import {DCOL_HEADER_SIZE, parseDcolHeader, totalBits} from "./dcolFormat.js";

/**
 * In-memory existence cache to avoid filesystem stat()/read calls.
 *
 * - Blob presence: Map<Slot, Set<RootHex>> — knows which (slot, root) have blob files
 * - Column bitmaps: Map<Slot, Map<RootHex, bigint>> — 128-bit bitmap per (slot, root)
 *
 * Uses bigint for 128-bit bitmaps since JavaScript doesn't have native 128-bit integers.
 */
export class ExistenceCache {
  private blobPresence = new Map<Slot, Set<RootHex>>();
  private columnBitmaps = new Map<Slot, Map<RootHex, bigint>>();

  // --- Slot → Root resolution (for finalized canonical lookups) ---

  /**
   * Return any root known at this slot (from blobs or columns).
   * For finalized slots there is exactly one canonical root per slot,
   * so this is equivalent to the old CanonicalSlotRootIndex lookup
   * but derived from data we already track.
   */
  getAnyRootForSlot(slot: Slot): RootHex | null {
    // Try blobs first
    const blobRoots = this.blobPresence.get(slot);
    if (blobRoots) {
      for (const root of blobRoots) return root;
    }
    // Try columns
    const colRoots = this.columnBitmaps.get(slot);
    if (colRoots) {
      for (const root of colRoots.keys()) return root;
    }
    return null;
  }

  // --- Blobs ---

  setBlobPresent(slot: Slot, rootHex: RootHex): void {
    let roots = this.blobPresence.get(slot);
    if (!roots) {
      roots = new Set();
      this.blobPresence.set(slot, roots);
    }
    roots.add(rootHex);
  }

  hasBlobPresent(slot: Slot, rootHex: RootHex): boolean {
    return this.blobPresence.get(slot)?.has(rootHex) ?? false;
  }

  removeBlobPresent(slot: Slot, rootHex: RootHex): void {
    const roots = this.blobPresence.get(slot);
    if (roots) {
      roots.delete(rootHex);
      if (roots.size === 0) this.blobPresence.delete(slot);
    }
  }

  // --- Columns ---

  setColumnsPresent(slot: Slot, rootHex: RootHex, indices: number[]): void {
    let roots = this.columnBitmaps.get(slot);
    if (!roots) {
      roots = new Map();
      this.columnBitmaps.set(slot, roots);
    }
    let bitmap = roots.get(rootHex) ?? 0n;
    for (const idx of indices) {
      bitmap |= 1n << BigInt(idx);
    }
    roots.set(rootHex, bitmap);
  }

  hasColumnPresent(slot: Slot, rootHex: RootHex, index: number): boolean {
    const bitmap = this.columnBitmaps.get(slot)?.get(rootHex);
    if (bitmap === undefined) return false;
    return (bitmap & (1n << BigInt(index))) !== 0n;
  }

  getColumnBitmap(slot: Slot, rootHex: RootHex): bigint | null {
    return this.columnBitmaps.get(slot)?.get(rootHex) ?? null;
  }

  removeColumns(slot: Slot, rootHex: RootHex): void {
    const roots = this.columnBitmaps.get(slot);
    if (roots) {
      roots.delete(rootHex);
      if (roots.size === 0) this.columnBitmaps.delete(slot);
    }
  }

  /**
   * Evict all entries with slot < minSlot.
   */
  evictBelow(minSlot: Slot): void {
    for (const [slot] of this.blobPresence) {
      if (slot < minSlot) this.blobPresence.delete(slot);
    }
    for (const [slot] of this.columnBitmaps) {
      if (slot < minSlot) this.columnBitmaps.delete(slot);
    }
  }

  /**
   * Rebuild cache from disk by scanning blob and column directories.
   * Ignores `.part` files.
   */
  async rebuildFromDisk(blobsDir: string, columnsDir: string): Promise<{blobs: number; columns: number}> {
    let blobCount = 0;
    let columnCount = 0;

    // Scan blobs directory
    try {
      const slotDirs = await fs.promises.readdir(blobsDir);
      for (const slotStr of slotDirs) {
        const slot = Number.parseInt(slotStr, 10);
        if (Number.isNaN(slot)) continue;
        const slotDir = path.join(blobsDir, slotStr);
        const files = await fs.promises.readdir(slotDir);
        for (const file of files) {
          if (file.endsWith(".part")) continue;
          if (file.endsWith(".ssz") && file.startsWith("0x")) {
            const rootHex = file.slice(0, -4); // strip .ssz
            this.setBlobPresent(slot, rootHex);
            blobCount++;
          }
        }
      }
    } catch (_e) {
      // Directory may not exist
    }

    // Scan columns directory
    try {
      const slotDirs = await fs.promises.readdir(columnsDir);
      for (const slotStr of slotDirs) {
        const slot = Number.parseInt(slotStr, 10);
        if (Number.isNaN(slot)) continue;
        const slotDir = path.join(columnsDir, slotStr);
        const files = await fs.promises.readdir(slotDir);
        for (const file of files) {
          if (file.endsWith(".part")) continue;
          if (file.endsWith(".dcol") && file.startsWith("0x")) {
            const rootHex = file.slice(0, -5); // strip .dcol
            // Read just the header to get the bitmap
            const filePath = path.join(slotDir, file);
            try {
              const fd = await fs.promises.open(filePath, "r");
              try {
                const headerBuf = new Uint8Array(DCOL_HEADER_SIZE);
                await fd.read(headerBuf, 0, DCOL_HEADER_SIZE, 0);
                const header = parseDcolHeader(headerBuf);
                const indices: number[] = [];
                const count = totalBits(header.bitmap);
                if (count > 0) {
                  for (let i = 0; i < 128; i++) {
                    if ((header.bitmap[Math.floor(i / 8)] & (1 << (i % 8))) !== 0) {
                      indices.push(i);
                    }
                  }
                }
                this.setColumnsPresent(slot, rootHex, indices);
                columnCount += indices.length;
              } finally {
                await fd.close();
              }
            } catch (_e) {
              // Corrupted file, skip
            }
          }
        }
      }
    } catch (_e) {
      // Directory may not exist
    }

    return {blobs: blobCount, columns: columnCount};
  }
}
