import {Slot} from "@lodestar/types";
import {IBeaconDb} from "../../../db/index.js";
import {StateArchive, StateArchiveSSZType} from "./stateArchive.js";

export async function getSnapshotStateArchiveWithFallback({
  slot,
  fallbackTillSlot,
  db,
}: {slot: Slot; fallbackTillSlot: Slot; db: IBeaconDb}): Promise<StateArchive | null> {
  const stateArchiveBytes = await db.stateArchive.getBinary(slot);
  if (stateArchiveBytes) {
    const stateArchive = StateArchiveSSZType.deserialize(stateArchiveBytes);
    if (stateArchive.snapshot) return stateArchive;
  }

  for await (const archiveBytes of db.stateArchive.valuesStream({lt: slot, gte: fallbackTillSlot})) {
    const stateArchive = StateArchiveSSZType.deserialize(archiveBytes);
    if (stateArchive.snapshot) return stateArchive;
  }

  return null;
}
