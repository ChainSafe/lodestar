import fs from "node:fs";
import path from "node:path";
import {RootHex, Slot} from "@lodestar/types";
import {isFsNotFoundError} from "./errors.js";
import {isValidRootHex, padSlot} from "./path.js";

export type ExistenceCacheRebuildStats = {
  blobFiles: number;
  columnFiles: number;
  ignoredBlobEntries: number;
  ignoredColumnEntries: number;
};

/**
 * In-memory existence cache to avoid filesystem stat()/read calls.
 *
 * - Blob presence: Map<Slot, Set<RootHex>> — knows which (slot, root) have blob files
 * - Column presence: Map<Slot, Set<RootHex>> — knows which (slot, root) have column files
 */
export class ExistenceCache {
  private blobPresence = new Map<Slot, Set<RootHex>>();
  private columnPresence = new Map<Slot, Set<RootHex>>();
  private blobFileCount = 0;
  private columnFileCount = 0;

  private trackBlobSlot(slot: Slot): Set<RootHex> {
    let roots = this.blobPresence.get(slot);
    if (!roots) {
      roots = new Set();
      this.blobPresence.set(slot, roots);
    }
    return roots;
  }

  private trackColumnSlot(slot: Slot): Set<RootHex> {
    let roots = this.columnPresence.get(slot);
    if (!roots) {
      roots = new Set();
      this.columnPresence.set(slot, roots);
    }
    return roots;
  }

  getBlobSlotsBefore(minSlot: Slot): Slot[] {
    return getSlotsBefore(this.blobPresence, minSlot);
  }

  getColumnSlotsBefore(minSlot: Slot): Slot[] {
    return getSlotsBefore(this.columnPresence, minSlot);
  }

  removeBlobSlot(slot: Slot): void {
    const roots = this.blobPresence.get(slot);
    if (roots) {
      this.blobFileCount -= roots.size;
      this.blobPresence.delete(slot);
    }
  }

  removeColumnSlot(slot: Slot): void {
    const roots = this.columnPresence.get(slot);
    if (roots) {
      this.columnFileCount -= roots.size;
      this.columnPresence.delete(slot);
    }
  }

  getBlobFileCount(): number {
    return this.blobFileCount;
  }

  getColumnFileCount(): number {
    return this.columnFileCount;
  }

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
    const roots = this.trackBlobSlot(slot);
    if (!roots.has(rootHex)) {
      roots.add(rootHex);
      this.blobFileCount++;
    }
  }

  removeBlobPresent(slot: Slot, rootHex: RootHex): void {
    if (this.blobPresence.get(slot)?.delete(rootHex)) {
      this.blobFileCount--;
    }
  }

  // --- Column files ---

  setColumnPresent(slot: Slot, rootHex: RootHex): void {
    const roots = this.trackColumnSlot(slot);
    if (!roots.has(rootHex)) {
      roots.add(rootHex);
      this.columnFileCount++;
    }
  }

  removeColumns(slot: Slot, rootHex: RootHex): void {
    if (this.columnPresence.get(slot)?.delete(rootHex)) {
      this.columnFileCount--;
    }
  }

  /**
   * Rebuild cache from disk by scanning blob and column directories.
   * Only canonical slot directories and root filenames are cached. Unknown
   * entries are left untouched on disk and reported to the caller.
   */
  async rebuildFromDisk(blobsDir: string, columnsDir: string): Promise<ExistenceCacheRebuildStats> {
    const blobStats = await scanStoreDirectory(
      blobsDir,
      ".ssz",
      (slot) => this.trackBlobSlot(slot),
      (slot, rootHex) => this.setBlobPresent(slot, rootHex)
    );
    const columnStats = await scanStoreDirectory(
      columnsDir,
      ".dcol",
      (slot) => this.trackColumnSlot(slot),
      (slot, rootHex) => this.setColumnPresent(slot, rootHex)
    );

    return {
      blobFiles: blobStats.files,
      columnFiles: columnStats.files,
      ignoredBlobEntries: blobStats.ignoredEntries,
      ignoredColumnEntries: columnStats.ignoredEntries,
    };
  }
}

async function scanStoreDirectory(
  dir: string,
  extension: ".ssz" | ".dcol",
  trackSlot: (slot: Slot) => void,
  setPresent: (slot: Slot, rootHex: RootHex) => void
): Promise<{files: number; ignoredEntries: number}> {
  let files = 0;
  let ignoredEntries = 0;

  try {
    const slotDirs = await fs.promises.readdir(dir, {withFileTypes: true});
    for (const entry of slotDirs) {
      const slot = Number(entry.name);
      if (!entry.isDirectory() || !Number.isSafeInteger(slot) || slot < 0 || entry.name !== padSlot(slot)) {
        ignoredEntries++;
        continue;
      }

      trackSlot(slot);
      const slotEntries = await fs.promises.readdir(path.join(dir, entry.name), {withFileTypes: true});
      for (const file of slotEntries) {
        const rootHex = file.name.slice(0, -extension.length);
        if (!file.isFile() || !file.name.endsWith(extension) || !isValidRootHex(rootHex)) {
          ignoredEntries++;
          continue;
        }

        setPresent(slot, rootHex);
        files++;
      }
    }
  } catch (e) {
    if (!isFsNotFoundError(e)) throw e;
  }

  return {files, ignoredEntries};
}

function getSlotsBefore(presence: Map<Slot, Set<RootHex>>, minSlot: Slot): Slot[] {
  const slots: Slot[] = [];
  for (const slot of presence.keys()) {
    if (slot < minSlot) slots.push(slot);
  }
  return slots;
}

function getOnlyValue(values: IterableIterator<RootHex> | undefined): RootHex | null {
  if (!values) return null;

  const first = values.next();
  if (first.done || !values.next().done) return null;

  return first.value;
}
