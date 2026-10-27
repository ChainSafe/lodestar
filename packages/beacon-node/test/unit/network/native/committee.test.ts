import {describe, expect, it} from "vitest";
import {ATTESTATION_SUBNET_COUNT, SLOTS_PER_EPOCH} from "@lodestar/params";
import {normalizeCommitteeSubscriptions} from "../../../../src/network/core/native/committee.js";

const duty = {slot: 0, subnet: 0, validatorIndex: 0, isAggregator: true};

describe("native committee inputs", () => {
  it("deduplicates 20,000 validator duties into per-slot subnet sets", () => {
    const rows = Array.from({length: 20_000}, (_, index) => ({
      ...duty,
      validatorIndex: index,
      slot: index % 2,
      subnet: Math.floor(index / 2) % ATTESTATION_SUBNET_COUNT,
    }));
    const demand = normalizeCommitteeSubscriptions(rows, false);
    const subnets = (1n << BigInt(ATTESTATION_SUBNET_COUNT)) - 1n;
    expect([...demand.attesters.values()]).toEqual([
      {slot: 0, subnets, aggregators: subnets},
      {slot: 1, subnets, aggregators: subnets},
    ]);
  });
  it("unions aggregators and keeps non-aggregators as peer demand only", () => {
    const demand = normalizeCommitteeSubscriptions(
      [
        {...duty, slot: 2, subnet: 63},
        {...duty, slot: 2, subnet: 1, isAggregator: false},
      ],
      false
    );
    expect(demand.attesters.get(2)).toEqual({slot: 2, subnets: (1n << 63n) | 2n, aggregators: 1n << 63n});
  });
  it("retains absolute sync expiries without interpreting a host clock", () => {
    const demand = normalizeCommitteeSubscriptions(
      [
        {...duty, slot: 1000},
        {...duty, slot: 999},
        {...duty, subnet: 3},
      ],
      true
    );
    expect(demand.sync).toEqual(
      new Map([
        [0, 1000],
        [3, 0],
      ])
    );
    expect(demand.attesters.size).toBe(0);
  });
  it("bounds distinct duty slots", () => {
    expect(() =>
      normalizeCommitteeSubscriptions(
        Array.from({length: 4 * SLOTS_PER_EPOCH + 1}, (_, slot) => ({...duty, slot})),
        false
      )
    ).toThrow("duty slots");
  });
});
