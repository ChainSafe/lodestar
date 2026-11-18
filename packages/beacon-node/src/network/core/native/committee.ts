import {NativeLocalIntent} from "@lodestar/native/network";
import {ATTESTATION_SUBNET_COUNT, SLOTS_PER_EPOCH, SYNC_COMMITTEE_SUBNET_COUNT} from "@lodestar/params";
import {Slot} from "@lodestar/types";
import {CommitteeSubscription} from "../../subnets/interface.js";
import {NativeNetworkError, NativeNetworkErrorCode, nativeInteger} from "./errors.js";

export type Attesters = NonNullable<NativeLocalIntent["attesters"]>[number];
type CommitteeDemand = {attesters: Map<number, Attesters>; sync: Map<number, number>};

export function normalizeCommitteeSubscriptions(
  subscriptions: CommitteeSubscription[],
  sync: boolean
): CommitteeDemand {
  const demand: CommitteeDemand = {attesters: new Map(), sync: new Map()};
  for (const {slot, subnet, validatorIndex, isAggregator} of subscriptions) {
    nativeInteger(slot, "duty slot", Number.MAX_SAFE_INTEGER - 1);
    nativeInteger(subnet, "duty subnet", (sync ? SYNC_COMMITTEE_SUBNET_COUNT : ATTESTATION_SUBNET_COUNT) - 1);
    nativeInteger(validatorIndex, "validator index");
    if (typeof isAggregator !== "boolean")
      throw new NativeNetworkError({code: NativeNetworkErrorCode.CONFIGURATION, resource: "aggregator flag"});
    if (sync) {
      demand.sync.set(subnet, Math.max(demand.sync.get(subnet) ?? 0, slot));
    } else {
      const row = demand.attesters.get(slot) ?? {slot, subnets: 0n, aggregators: 0n};
      row.subnets |= 1n << BigInt(subnet);
      if (isAggregator) row.aggregators |= 1n << BigInt(subnet);
      demand.attesters.set(slot, row);
      nativeInteger(demand.attesters.size, "duty slots", 4 * SLOTS_PER_EPOCH);
    }
  }
  return demand;
}

export function proposalSubscriptions(
  proposalSlots: Slot[],
  currentSlot: Slot,
  proposalLead: number,
  aggregatorLead: number
): Attesters[] {
  if (proposalLead === 0) return [];
  const rows = new Map<Slot, Attesters>();
  const aggregators = (1n << BigInt(ATTESTATION_SUBNET_COUNT)) - 1n;
  for (const proposalSlot of proposalSlots) {
    const first = proposalSlot - proposalLead + Math.min(aggregatorLead, proposalLead - 1);
    for (let slot = Math.max(currentSlot, first); slot < proposalSlot; slot++) {
      rows.set(slot, {slot, subnets: 0n, aggregators});
    }
  }
  return [...rows.values()];
}
