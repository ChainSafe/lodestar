import {Slot} from "@lodestar/types";
import {IBeaconDb} from "../../../db/index.js";

export async function getSnapshotStateWithFallback(
  slot: Slot,
  db: IBeaconDb
): Promise<{stateBytes: Uint8Array | null; slot: Slot}> {
  const state = await db.stateArchive.getBinary(slot);
  if (state) return {slot, stateBytes: state};

  // There is a possibility that node is started with checkpoint and initial snapshot
  // is not persisted on expected slot
  const lastSnapshotSlot = await db.stateArchive.lastKey();
  if (lastSnapshotSlot !== null)
    return {
      slot: lastSnapshotSlot,
      stateBytes: await db.stateArchive.getBinary(lastSnapshotSlot),
    };

  return {stateBytes: null, slot};
}
