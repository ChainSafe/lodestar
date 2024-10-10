import {Slot} from "@lodestar/types";
import {IBeaconDb} from "../../../db/index.js";

export async function getSnapshotStateWithFallback(
  slot: Slot,
  db: IBeaconDb
): Promise<{stateBytes: Uint8Array | null; slot: Slot}> {
  const state = await db.stateSnapshotArchive.getBinary(slot);
  if (state) return {slot, stateBytes: state};

  // There is a possibility that node is started with checkpoint and initial snapshot
  // is not persisted on expected slot
  const lastSnapshotSlot = await db.stateSnapshotArchive.lastKey();
  if (lastSnapshotSlot !== null)
    return {
      slot: lastSnapshotSlot,
      stateBytes: await db.stateSnapshotArchive.getBinary(lastSnapshotSlot),
    };

  return {stateBytes: null, slot};
}
