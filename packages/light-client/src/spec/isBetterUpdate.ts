import {SYNC_COMMITTEE_SIZE} from "@lodestar/params";
import {Slot, allForks} from "@lodestar/types";
import {computeSyncPeriodAtSlot} from "../utils/index.js";
import {isFinalityUpdate, isSyncCommitteeUpdate, sumBits} from "./utils.js";

/**
 * Wrapper type for `isBetterUpdate()` so we can apply its logic without requiring the full LightClientUpdate type.
 */
export type LightClientUpdateSummary = {
  activeParticipants: number;
  attestedHeaderSlot: Slot;
  signatureSlot: Slot;
  finalizedHeaderSlot: Slot;
  /** `if update.next_sync_committee_branch != [Bytes32() for _ in range(floorlog2(NEXT_SYNC_COMMITTEE_INDEX))]` */
  isSyncCommitteeUpdate: boolean;
  /** `if update.finality_branch != [Bytes32() for _ in range(floorlog2(FINALIZED_ROOT_INDEX))]` */
  isFinalityUpdate: boolean;
};

/**
 * Returns the update with more bits. On ties, prevUpdate is the better
 *
 * https://github.com/ethereum/consensus-specs/blob/be3c774069e16e89145660be511c1b183056017e/specs/altair/light-client/sync-protocol.md#is_better_update
 */
export function isBetterUpdate(newUpdate: LightClientUpdateSummary, oldUpdate: LightClientUpdateSummary): boolean {
  // Compare supermajority (> 2/3) sync committee participation
  const newNumActiveParticipants = newUpdate.activeParticipants;
  const oldNumActiveParticipants = oldUpdate.activeParticipants;
  const newHasSupermajority = newNumActiveParticipants * 3 >= SYNC_COMMITTEE_SIZE * 2;
  const oldHasSupermajority = oldNumActiveParticipants * 3 >= SYNC_COMMITTEE_SIZE * 2;
  if (newHasSupermajority != oldHasSupermajority) {
    return newHasSupermajority;
  }
  if (!newHasSupermajority && newNumActiveParticipants != oldNumActiveParticipants) {
    return newNumActiveParticipants > oldNumActiveParticipants;
  }

  // Compare presence of relevant sync committee
  const newHasRelevantSyncCommittee =
    newUpdate.isSyncCommitteeUpdate &&
    computeSyncPeriodAtSlot(newUpdate.attestedHeaderSlot) == computeSyncPeriodAtSlot(newUpdate.signatureSlot);
  const oldHasRelevantSyncCommittee =
    oldUpdate.isSyncCommitteeUpdate &&
    computeSyncPeriodAtSlot(oldUpdate.attestedHeaderSlot) == computeSyncPeriodAtSlot(oldUpdate.signatureSlot);
  if (newHasRelevantSyncCommittee != oldHasRelevantSyncCommittee) {
    return newHasRelevantSyncCommittee;
  }

  // Compare indication of any finality
  const newHasFinality = newUpdate.isFinalityUpdate;
  const oldHasFinality = oldUpdate.isFinalityUpdate;
  if (newHasFinality != oldHasFinality) {
    return newHasFinality;
  }

  // Compare sync committee finality
  if (newHasFinality) {
    const newHasSyncCommitteeFinality =
      computeSyncPeriodAtSlot(newUpdate.finalizedHeaderSlot) == computeSyncPeriodAtSlot(newUpdate.attestedHeaderSlot);
    const oldHasSyncCommitteeFinality =
      computeSyncPeriodAtSlot(oldUpdate.finalizedHeaderSlot) == computeSyncPeriodAtSlot(oldUpdate.attestedHeaderSlot);
    if (newHasSyncCommitteeFinality != oldHasSyncCommitteeFinality) {
      return newHasSyncCommitteeFinality;
    }
  }

  // Tiebreaker 1: Sync committee participation beyond supermajority
  if (newNumActiveParticipants != oldNumActiveParticipants) {
    return newNumActiveParticipants > oldNumActiveParticipants;
  }

  // Tiebreaker 2: Prefer older data (fewer changes to best)
  if (newUpdate.attestedHeaderSlot != oldUpdate.attestedHeaderSlot) {
    return newUpdate.attestedHeaderSlot < oldUpdate.attestedHeaderSlot;
  }
  return newUpdate.signatureSlot < oldUpdate.signatureSlot;
}

export function isSafeLightClientUpdate(update: LightClientUpdateSummary): boolean {
  return (
    update.activeParticipants * 3 >= SYNC_COMMITTEE_SIZE * 2 && update.isFinalityUpdate && update.isSyncCommitteeUpdate
  );
}

export function toLightClientUpdateSummary(update: allForks.LightClientUpdate): LightClientUpdateSummary {
  return {
    activeParticipants: sumBits(update.syncAggregate.syncCommitteeBits),
    attestedHeaderSlot: update.attestedHeader.beacon.slot,
    signatureSlot: update.signatureSlot,
    finalizedHeaderSlot: update.finalizedHeader.beacon.slot,
    isSyncCommitteeUpdate: isSyncCommitteeUpdate(update),
    isFinalityUpdate: isFinalityUpdate(update),
  };
}
