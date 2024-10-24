import {Slot} from "@lodestar/types";
import {IBeaconDb} from "../../../db/index.js";
import {StateArchive} from "../../../db/repositories/hierarchicalStateArchive.js";

export async function getSnapshotStateArchiveWithFallback({
  slot,
  fallbackTillSlot,
  db,
}: {slot: Slot; fallbackTillSlot: Slot; db: IBeaconDb}): Promise<StateArchive | null> {
  const stateArchive = await db.hierarchicalStateArchiveRepository.get(slot);
  if (stateArchive?.snapshot) return stateArchive;

  for await (const stateArchive of db.hierarchicalStateArchiveRepository.valuesStream({
    lt: slot,
    gte: fallbackTillSlot,
  })) {
    if (stateArchive.snapshot) return stateArchive;
  }

  return null;
}
