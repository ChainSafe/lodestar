import fs from "node:fs";
import {Slot} from "@lodestar/types";
import {isFsNotFoundError} from "./errors.js";
import {padSlot} from "./path.js";

export type SlotIndexRebuildStats = {
  slots: number;
  ignoredEntries: number;
};

export class SlotIndex {
  private readonly slots = new Set<Slot>();

  add(slot: Slot): void {
    this.slots.add(slot);
  }

  remove(slot: Slot): void {
    this.slots.delete(slot);
  }

  getBefore(minSlot: Slot): Slot[] {
    const slots: Slot[] = [];
    for (const slot of this.slots) {
      if (slot < minSlot) slots.push(slot);
    }
    return slots;
  }

  async rebuildFromDisk(columnsDir: string): Promise<SlotIndexRebuildStats> {
    this.slots.clear();
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(columnsDir, {withFileTypes: true});
    } catch (e) {
      if (!isFsNotFoundError(e)) throw e;
      return {slots: 0, ignoredEntries: 0};
    }

    let ignoredEntries = 0;
    for (const entry of entries) {
      const slot = Number(entry.name);
      if (!entry.isDirectory() || !Number.isSafeInteger(slot) || slot < 0 || entry.name !== padSlot(slot)) {
        ignoredEntries++;
        continue;
      }
      this.slots.add(slot);
    }

    return {slots: this.slots.size, ignoredEntries};
  }
}
