import {describe, expect, it, vi} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {ATTESTATION_SUBNET_COUNT, SLOTS_PER_EPOCH} from "@lodestar/params";
import {normalizeCommitteeSubscriptions} from "../../../../src/network/core/native/committee.js";
import {ClockStopped} from "../../../mocks/clock.js";

const config = createBeaconConfig({}, new Uint8Array(32));
const duty = {slot: 0, subnet: 0, validatorIndex: 0, isAggregator: true};

describe("native committee demand", () => {
  it.each([4098, 8738, 20_000])("folds %s validator duties into protocol-bounded demand", (count) => {
    const rows = Array.from({length: count}, (_, index) => ({
      ...duty,
      validatorIndex: Math.floor(index / 2),
      slot: index % (2 * SLOTS_PER_EPOCH),
      subnet: index % ATTESTATION_SUBNET_COUNT,
    }));
    const demand = normalizeCommitteeSubscriptions(rows, false, new ClockStopped(0), config);
    expect(demand.attDuties.size).toBe(2 * SLOTS_PER_EPOCH);
    expect(demand.attDemand.size).toBe(ATTESTATION_SUBNET_COUNT);
    expect(demand.syncDuties.size).toBe(0);
    for (let subnet = 0; subnet < ATTESTATION_SUBNET_COUNT; subnet++) {
      const matching = rows.filter((row) => row.subnet === subnet);
      expect(demand.attDemand.get(subnet), `wrong expiry for subnet ${subnet}`).toBe(
        Math.max(...matching.map((row) => row.slot + 1))
      );
      for (const slot of new Set(matching.map((row) => row.slot)))
        expect(
          (demand.attDuties.get(slot) ?? 0n) & (1n << BigInt(subnet)),
          `missing subnet ${subnet} at slot ${slot}`
        ).not.toBe(0n);
    }
  });

  it("unions aggregators, extends discovery demand, and keeps non-aggregators out of local joins", () => {
    const demand = normalizeCommitteeSubscriptions(
      [
        {...duty, subnet: 63, slot: 2},
        {...duty, subnet: 1, slot: 2},
        {...duty, subnet: 63, slot: 1},
        {...duty, subnet: 1, slot: 3, isAggregator: false},
        {...duty, subnet: 1, slot: 0, isAggregator: false},
      ],
      false,
      new ClockStopped(0),
      config
    );
    expect(demand.attDuties.get(2)).toBe((1n << 63n) | 2n);
    expect(demand.attDuties.has(3)).toBe(false);
    expect(demand.attDemand).toEqual(
      new Map([
        [63, 3],
        [1, 4],
      ])
    );
  });

  it("bounds attester demand to current and next epoch with API clock tolerance", () => {
    const clock = new ClockStopped(5 * SLOTS_PER_EPOCH - 1);
    const future = {...duty, slot: 7 * SLOTS_PER_EPOCH - 1};
    expect(() => normalizeCommitteeSubscriptions([future], false, clock, config)).toThrow("attester duty horizon");
    const tolerant = vi.spyOn(clock, "slotWithFutureTolerance").mockReturnValue(5 * SLOTS_PER_EPOCH);
    expect(normalizeCommitteeSubscriptions([future], false, clock, config).attDuties.get(future.slot)).toBe(1n);
    expect(tolerant).toHaveBeenCalledWith(
      Math.min(config.MAXIMUM_GOSSIP_CLOCK_DISPARITY / 1000, config.SLOT_DURATION_MS / 2000)
    );
    expect(() => normalizeCommitteeSubscriptions([{...future, slot: future.slot + 1}], false, clock, config)).toThrow(
      "attester duty horizon"
    );
  });

  it("ignores expired network demand while retaining recent aggregator history", () => {
    const slot = 10 * SLOTS_PER_EPOCH;
    const demand = normalizeCommitteeSubscriptions(
      [
        {...duty, slot: slot - 2},
        {...duty, slot: slot - 2 * SLOTS_PER_EPOCH},
      ],
      false,
      new ClockStopped(slot),
      config
    );
    expect(demand.attDemand.size).toBe(0);
    expect(demand.attDuties).toEqual(new Map([[slot - 2, 1n]]));
  });

  it("keeps independent long-lived sync expiries and their maximum per subnet", () => {
    const expiry = 1024 * SLOTS_PER_EPOCH;
    const demand = normalizeCommitteeSubscriptions(
      [
        {...duty, slot: expiry},
        {...duty, slot: expiry - SLOTS_PER_EPOCH},
        {...duty, subnet: 3, slot: 0},
      ],
      true,
      new ClockStopped(2 * SLOTS_PER_EPOCH),
      config
    );
    expect(demand.syncDuties).toEqual(new Map([[0, expiry]]));
    expect(demand.attDuties.size).toBe(0);
    expect(demand.attDemand.size).toBe(0);
  });

  it.each([
    {...duty, slot: Number.NaN},
    {...duty, slot: Number.MAX_SAFE_INTEGER},
    {...duty, slot: -1},
    {...duty, subnet: 64},
    {...duty, validatorIndex: -1},
    {...duty, isAggregator: undefined},
  ])("validates even stale or redundant rows: %j", (invalid) => {
    expect(() =>
      // @ts-expect-error Exercise malformed external input.
      normalizeCommitteeSubscriptions([duty, invalid], false, new ClockStopped(100 * SLOTS_PER_EPOCH), config)
    ).toThrow();
  });
});
