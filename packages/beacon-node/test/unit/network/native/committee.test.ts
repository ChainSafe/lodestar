import {describe, expect, it} from "vitest";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {mergeCommitteeDemand, normalizeCommitteeSubscriptions} from "../../../../src/network/core/native/committee.js";

const duty = {slot: 0, subnet: 0, validatorIndex: 0, isAggregator: true};

describe("native committee inputs", () => {
  it.each([4098, 8738, 20_000])("folds %s validator duties into bounded slot rows", (count) => {
    const rows = Array.from({length: count}, (_, index) => ({
      ...duty,
      validatorIndex: index,
      slot: index % (2 * SLOTS_PER_EPOCH),
      subnet: index % 64,
    }));
    const demand = normalizeCommitteeSubscriptions(rows, false);
    expect(demand.attesters.size).toBe(2 * SLOTS_PER_EPOCH);
    for (const row of rows) {
      const bit = 1n << BigInt(row.subnet);
      expect((demand.attesters.get(row.slot)?.aggregators ?? 0n) & bit).toBe(bit);
    }
  });
  it("unions aggregators and keeps non-aggregators as peer demand only", () => {
    const first = normalizeCommitteeSubscriptions([{...duty, slot: 2, subnet: 63}], false);
    const second = normalizeCommitteeSubscriptions([{...duty, slot: 2, subnet: 1, isAggregator: false}], false);
    const merged = mergeCommitteeDemand(first, second);
    expect(merged.attesters.get(2)).toEqual({slot: 2, subnets: (1n << 63n) | 2n, aggregators: 1n << 63n});
    expect(first.attesters.get(2)?.subnets).toBe(1n << 63n);
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
  it("bounds distinct slots when merging pending batches", () => {
    const first = normalizeCommitteeSubscriptions(
      Array.from({length: 4 * SLOTS_PER_EPOCH}, (_, slot) => ({...duty, slot})),
      false
    );
    const extra = normalizeCommitteeSubscriptions([{...duty, slot: 4 * SLOTS_PER_EPOCH}], false);
    expect(() => mergeCommitteeDemand(first, extra)).toThrow("duty slots");
    expect(first.attesters.size).toBe(4 * SLOTS_PER_EPOCH);
  });
  it.each([
    {...duty, slot: Number.NaN},
    {...duty, slot: Number.MAX_SAFE_INTEGER},
    {...duty, slot: -1},
    {...duty, subnet: 64},
    {...duty, validatorIndex: -1},
    {...duty, isAggregator: undefined},
  ])("validates redundant rows: %j", (invalid) => {
    // @ts-expect-error Exercise malformed caller input.
    expect(() => normalizeCommitteeSubscriptions([duty, invalid], false)).toThrow();
  });
});
