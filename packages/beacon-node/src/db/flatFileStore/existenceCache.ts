import fs from "node:fs";
import path from "node:path";
import {RootHex, Slot} from "@lodestar/types";
import {isFsNotFoundError} from "./errors.js";

/**
 * In-memory existence cache to avoid filesystem stat()/read calls.
 *
 * - Blob presence: Map<Slot, Set<RootHex>> — knows which (slot, root) have blob files
 * - Column presence: Map<Slot, Set<RootHex>> — knows which (slot, root) have column files
 */
export class ExistenceCache {
  private blobPresence = new Map<Slot, Set<RootHex>>();
  private columnPresence = new Map<Slot, Set<RootHex>>();

  // --- Slot → Root resolution (for finalized canonical lookups) ---

  /**
   * Return the blob root only when exactly one root is known at this slot.
   * Multiple roots can coexist until finalization cleanup completes, so choosing
   * an arbitrary root could return sidecars from a non-canonical block.
   */
  getUniqueBlobRootForSlot(slot: Slot): RootHex | null {
    return getOnlyValue(this.blobPresence.get(slot)?.values());
  }

  /**
   * Return the column root only when exactly one root is known at this slot.
   */
  getUniqueColumnRootForSlot(slot: Slot): RootHex | null {
    return getOnlyValue(this.columnPresence.get(slot)?.values());
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

  // --- Column files ---

  setColumnPresent(slot: Slot, rootHex: RootHex): void {
    let roots = this.columnPresence.get(slot);
    if (!roots) {
      roots = new Set();
      this.columnPresence.set(slot, roots);
    }
    roots.add(rootHex);
  }

  hasColumnPresent(slot: Slot, rootHex: RootHex): boolean {
    return this.columnPresence.get(slot)?.has(rootHex) ?? false;
  }

  removeColumns(slot: Slot, rootHex: RootHex): void {
    const roots = this.columnPresence.get(slot);
    if (roots) {
      roots.delete(rootHex);
      if (roots.size === 0) this.columnPresence.delete(slot);
    }
  }

  evictBlobsBelow(minSlot: Slot): void {
    for (const [slot] of this.blobPresence) {
      if (slot < minSlot) this.blobPresence.delete(slot);
    }
  }

  evictColumnsBelow(minSlot: Slot): void {
    for (const [slot] of this.columnPresence) {
      if (slot < minSlot) this.columnPresence.delete(slot);
    }
  }

  /**
   * Rebuild cache from disk by scanning blob and column directories.
   * Ignores `.part` files.
   */
  async rebuildFromDisk(blobsDir: string, columnsDir: string): Promise<{blobFiles: number; columnFiles: number}> {
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
    } catch (e) {
      if (!isFsNotFoundError(e)) throw e;
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
            this.setColumnPresent(slot, rootHex);
            columnCount++;
          }
        }
      }
    } catch (e) {
      if (!isFsNotFoundError(e)) throw e;
    }

    return {blobFiles: blobCount, columnFiles: columnCount};
  }
}

function getOnlyValue(values: IterableIterator<RootHex> | undefined): RootHex | null {
  if (!values) return null;

  const first = values.next();
  if (first.done || !values.next().done) return null;

  return first.value;
}
