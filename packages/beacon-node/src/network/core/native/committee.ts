import {BeaconConfig} from "@lodestar/config";
import {ATTESTATION_SUBNET_COUNT, SLOTS_PER_EPOCH, SYNC_COMMITTEE_SUBNET_COUNT} from "@lodestar/params";
import {IClock} from "../../../util/clock.js";
import {CommitteeSubscription} from "../../subnets/interface.js";
import {NativeNetworkError, NativeNetworkErrorCode, nativeInteger} from "./errors.js";

export type CommitteeDemand = {
  attDuties: Map<number, bigint>;
  attDemand: Map<number, number>;
  syncDuties: Map<number, number>;
};

export function committeeDemand(): CommitteeDemand {
  return {attDuties: new Map(), attDemand: new Map(), syncDuties: new Map()};
}

export function normalizeCommitteeSubscriptions(
  subscriptions: CommitteeSubscription[],
  sync: boolean,
  clock: IClock,
  config: BeaconConfig
): CommitteeDemand {
  const currentSlot = Math.max(0, clock.currentSlot);
  const tolerance = Math.min(config.MAXIMUM_GOSSIP_CLOCK_DISPARITY / 1000, config.SLOT_DURATION_MS / 2000);
  const latestEpoch = Math.floor(Math.max(0, clock.slotWithFutureTolerance(tolerance)) / SLOTS_PER_EPOCH) + 1;
  const latestSlot = (latestEpoch + 1) * SLOTS_PER_EPOCH - 1;
  const earliestAggregatorSlot = Math.max(0, currentSlot - 2 * SLOTS_PER_EPOCH + 1);
  const epochSlot = Math.floor(currentSlot / SLOTS_PER_EPOCH) * SLOTS_PER_EPOCH;
  const demand = committeeDemand();
  // The API bounds the input body. Retained demand depends on subnets and duty epochs, not validator count.
  for (const {slot, subnet, validatorIndex, isAggregator} of subscriptions) {
    nativeInteger(slot, "duty slot", Number.MAX_SAFE_INTEGER - 1);
    nativeInteger(subnet, "duty subnet", (sync ? SYNC_COMMITTEE_SUBNET_COUNT : ATTESTATION_SUBNET_COUNT) - 1);
    nativeInteger(validatorIndex, "validator index");
    if (typeof isAggregator !== "boolean")
      throw new NativeNetworkError({code: NativeNetworkErrorCode.CONFIGURATION, resource: "aggregator flag"});
    if (sync) {
      if (slot >= epochSlot) demand.syncDuties.set(subnet, Math.max(demand.syncDuties.get(subnet) ?? 0, slot));
    } else {
      if (slot > latestSlot)
        throw new NativeNetworkError({code: NativeNetworkErrorCode.CONFIGURATION, resource: "attester duty horizon"});
      if (slot + 1 >= currentSlot) demand.attDemand.set(subnet, Math.max(demand.attDemand.get(subnet) ?? 0, slot + 1));
      if (isAggregator && slot >= earliestAggregatorSlot)
        demand.attDuties.set(slot, (demand.attDuties.get(slot) ?? 0n) | (1n << BigInt(subnet)));
    }
  }
  return demand;
}

export function mergeCommitteeDemand(target: CommitteeDemand, incoming: CommitteeDemand): void {
  for (const [slot, mask] of incoming.attDuties) target.attDuties.set(slot, (target.attDuties.get(slot) ?? 0n) | mask);
  for (const [subnet, expiry] of incoming.attDemand)
    target.attDemand.set(subnet, Math.max(target.attDemand.get(subnet) ?? 0, expiry));
  for (const [subnet, expiry] of incoming.syncDuties)
    target.syncDuties.set(subnet, Math.max(target.syncDuties.get(subnet) ?? 0, expiry));
}

export function pruneCommitteeDemand(demand: CommitteeDemand, slot: number, historySlots = 0): void {
  for (const key of demand.attDuties.keys()) if (key < slot - historySlots) demand.attDuties.delete(key);
  for (const [key, expiry] of demand.attDemand) if (expiry < slot) demand.attDemand.delete(key);
  const epochSlot = Math.floor(slot / SLOTS_PER_EPOCH) * SLOTS_PER_EPOCH;
  for (const [key, expiry] of demand.syncDuties) if (expiry < epochSlot) demand.syncDuties.delete(key);
}
