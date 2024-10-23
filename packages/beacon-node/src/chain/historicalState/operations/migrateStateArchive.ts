import {Logger} from "@lodestar/logger";
import {IBeaconDb} from "../../../db/interface.js";
import {StateArchiveMode} from "../../archiver/interface.js";
import {StateArchiveSSZType} from "../../../db/repositories/stateArchive.js";

export async function migrateStateArchive({
  db,
  archiveMode,
  logger,
}: {db: IBeaconDb; archiveMode: StateArchiveMode; logger?: Logger}): Promise<void> {
  if (archiveMode === StateArchiveMode.Differential) {
    const lastStoredSlot = await db.stateArchive.lastKey();
    if (!lastStoredSlot) return;

    const archiveBytes = await db.stateArchive.getBinary(lastStoredSlot);
    if (!archiveBytes) return;

    try {
      StateArchiveSSZType.deserialize(archiveBytes);
    } catch {
      logger?.info("Found that stateArchiveMode was switch recently. Cleaning up state archives to store new format.");
      for await (const slot of db.stateArchive.keysStream()) {
        await db.stateArchive.delete(slot);
      }
    }
  }

  return;
}
