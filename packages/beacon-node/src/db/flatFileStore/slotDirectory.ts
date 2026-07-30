import fs from "node:fs";
import path from "node:path";
import {Slot} from "@lodestar/types";
import {isFsNotFoundError} from "./errors.js";

export async function removeSlotDirectories(dir: string, shouldRemove: (slot: Slot) => boolean): Promise<number> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, {withFileTypes: true});
  } catch (e) {
    if (!isFsNotFoundError(e)) throw e;
    return 0;
  }

  let removed = 0;
  for (const entry of entries) {
    const slot = Number(entry.name);
    if (!entry.isDirectory() || !Number.isSafeInteger(slot) || slot < 0 || !shouldRemove(slot)) continue;

    await fs.promises.rm(path.join(dir, entry.name), {recursive: true, force: true});
    removed++;
  }

  return removed;
}
