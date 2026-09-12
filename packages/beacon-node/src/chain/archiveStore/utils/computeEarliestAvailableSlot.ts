import {Slot} from "@lodestar/types";
import {IBeaconDb} from "../../../db/interface.js";

/**
 * Compute the earliest slot for which this node can fully serve by-range requests, derived from
 * what is actually persisted in the DB rather than from a static anchor slot.
 *
 * A node advertises this value in its Fulu `Status` (`earliestAvailableSlot`) and the by-range
 * handlers reject any request that falls entirely below it. If the advertised value does not match
 * the data the node actually holds, syncing peers either skip it or receive 0 results and can get
 * stuck (see https://github.com/ChainSafe/lodestar/issues/8147).
 *
 * Per the spec (`fulu/p2p-interface.md`) this is the earliest slot from which the node can serve
 * everything a peer requests together, so we take the most restrictive (highest) lower bound across
 * blocks + blob sidecars + custody (data column) sidecars; we never advertise a slot we cannot fully
 * serve. Sidecars are pruned to a rolling retention window and are usually the binding constraint.
 *
 * The block bound is the oldest slot *contiguously connected to the anchor* (not the global oldest
 * archived block): a node that checkpoint-synced ahead of pre-existing DB data holds a gap below its
 * new anchor, and advertising below that gap would strand peers requesting the missing range.
 */
export async function computeEarliestAvailableSlot(db: IBeaconDb, anchorSlot: Slot): Promise<Slot> {
  let earliestAvailableSlot = await oldestContiguousBlockSlot(db, anchorSlot);

  // Blob sidecars (Deneb+) are pruned to MIN_EPOCHS_FOR_BLOB_SIDECARS_REQUESTS, raising the bound.
  const oldestBlobSlot = await db.blobSidecarsArchive.firstKey();
  if (oldestBlobSlot != null) {
    earliestAvailableSlot = Math.max(earliestAvailableSlot, oldestBlobSlot);
  }

  // Data column sidecars (Fulu+) are pruned to MIN_EPOCHS_FOR_DATA_COLUMN_SIDECARS_REQUESTS. The
  // archive is keyed by (slot, columnIndex); the first ascending key holds the oldest slot.
  const [oldestColumnKey] = await db.dataColumnSidecarArchive.keys({limit: 1});
  if (oldestColumnKey != null) {
    earliestAvailableSlot = Math.max(earliestAvailableSlot, oldestColumnKey.prefix);
  }

  return earliestAvailableSlot;
}

/**
 * Oldest block slot contiguously connected to `anchorSlot` (and therefore to head), using the
 * verified `backfilledRanges` (each entry maps an upper slot back to the lower slot it is
 * contiguously filled down to). Starts at the anchor and repeatedly extends the lower bound through
 * abutting ranges; ranges that do not connect to the contiguous window - e.g. stale archived data
 * sitting below a checkpoint-sync-ahead gap - are ignored, so we never advertise below a gap.
 */
async function oldestContiguousBlockSlot(db: IBeaconDb, anchorSlot: Slot): Promise<Slot> {
  const ranges = await db.backfilledRanges.entries();

  let lower = anchorSlot;
  for (let extended = true; extended; ) {
    extended = false;
    for (const {key: upper, value: rangeLower} of ranges) {
      // Range [rangeLower, upper] abuts/overlaps the current contiguous window and reaches lower.
      if (rangeLower < lower && upper >= lower) {
        lower = rangeLower;
        extended = true;
      }
    }
  }

  return lower;
}
