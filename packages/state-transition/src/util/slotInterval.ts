import {INTERVALS_PER_SLOT} from "@lodestar/params";
import {Slot} from "@lodestar/types";
/**
 * SlotInterval defines intervals within a slot.
 * For example, attestation propagation happens at the beginning of interval 1 (second interval) of the slot
 * whereas block propagation happens at the beginning of interval 0 (first interval) of the slot.
 *
 * This can also be interpret as seconds into the slot.
 * For example, block propagation happens at (0 * SECONDS_PER_SLOT / INTERVALS_PER_SLOT) seconds into the slot
 * and attestation propagation happens (1 * SECONDS_PER_SLOT / INTERVALS_PER_SLOT) seconds into the slot
 *
 * Some intervals might have several validator actions eg. aggregate and sync aggregate both happening at the beginning
 * inteval 2.
 */
/* eslint-disable @typescript-eslint/no-duplicate-enum-values */
export enum SlotInterval {
  BLOCK_PROPAGATION = 0,
  SYNC_ATTESTATION_PROPAGATION = 0,
  BEACON_COMMITTEE_SELECTION = 0,
  ATTESTATION_PROPAGATION = 1,
  SYNC_COMMITTEE_SELECTION = 1,
  AGGREGATION_PROPAGATION = 2,
  SYNC_AGGREGATE_PROPAGATION = 2,
}

export const ONE_INTERVAL_OF_SLOT = 1 / INTERVALS_PER_SLOT;

/** Return a decimal slot given slot and interval */
export function calculateSlotWithInterval(slot: Slot, interval: SlotInterval): Slot {
  return slot + getSlotFractionFromInterval(interval);
}

/** Return a fraction of a slot given interval */
export function getSlotFractionFromInterval(interval: SlotInterval): Slot {
  return interval / INTERVALS_PER_SLOT;
}
export function endOfInterval(interval: SlotInterval): Slot {
  return interval + 1;
}
