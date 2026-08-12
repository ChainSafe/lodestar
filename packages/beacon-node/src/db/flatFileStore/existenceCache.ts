import fs from "node:fs";
import path from "node:path";
import {RootHex, Slot} from "@lodestar/types";
import {isFsNotFoundError} from "./errors.js";
import {isValidRootHex, padSlot} from "./path.js";

export type ExistenceCacheRebuildStats = {
  columnFiles: number;
  ignoredColumnEntries: number;
};

/**
 * In-memory existence cache to avoid filesystem stat()/read calls.
 *
 * Column presence is tracked as Map<Slot, Set<RootHex>>.
 */
export class ExistenceCache {
  private columnPresence = new Map<Slot, Set<RootHex>>();
  private columnFileCount = 0;

  private trackColumnSlot(slot: Slot): Set<RootHex> {
    let roots = this.columnPresence.get(slot);
    if (!roots) {
      roots = new Set();
      this.columnPresence.set(slot, roots);
    }
    return roots;
  }

  getColumnSlotsBefore(minSlot: Slot): Slot[] {
    return getSlotsBefore(this.columnPresence, minSlot);
  }

  removeColumnSlot(slot: Slot): void {
    const roots = this.columnPresence.get(slot);
    if (roots) {
      this.columnFileCount -= roots.size;
      this.columnPresence.delete(slot);
    }
  }

  getColumnFileCount(): number {
    return this.columnFileCount;
  }

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
   * Rebuild cache from disk by scanning the column directory.
   * Only canonical slot directories and root filenames are cached. Unknown
   * entries are left untouched on disk and reported to the caller.
   */
  async rebuildFromDisk(columnsDir: string): Promise<ExistenceCacheRebuildStats> {
    const columnStats = await scanStoreDirectory(
      columnsDir,
      (slot) => this.trackColumnSlot(slot),
      (slot, rootHex) => this.setColumnPresent(slot, rootHex)
    );

    return {
      columnFiles: columnStats.files,
      ignoredColumnEntries: columnStats.ignoredEntries,
    };
  }
}

async function scanStoreDirectory(
  dir: string,
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
        const rootHex = file.name.slice(0, -".dcol".length);
        if (!file.isFile() || !file.name.endsWith(".dcol") || !isValidRootHex(rootHex)) {
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
