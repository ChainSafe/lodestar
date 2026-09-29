import {afterEach, assert, describe, expect, it, vi} from "vitest";
import {createBeaconConfig, createChainForkConfig} from "@lodestar/config";
import {SLOTS_PER_EPOCH, forkAll} from "@lodestar/params";
import {ssz, sszTypesFor} from "@lodestar/types";
import {readBeaconStateBytesMetadata, scanActiveValidatorsFromStateBytes} from "../../../src/util/sszBytes.js";
import {
  computeWeakSubjectivityPeriod,
  computeWeakSubjectivitySummaryFromStateBytes,
  isWithinWeakSubjectivityPeriodFromSummary,
} from "../../../src/util/weakSubjectivity.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("state bytes weak subjectivity", () => {
  it.each(forkAll)("matches state-based calculations for %s", (fork) => {
    const config = createBeaconConfig({}, new Uint8Array(32));
    vi.spyOn(config, "getForkName").mockReturnValue(fork);
    const stateType = sszTypesFor(fork).BeaconState;
    const state = stateType.defaultViewDU();
    state.slot = 3 * SLOTS_PER_EPOCH + 1;
    state.genesisTime = 2 ** 32 + 100;
    state.genesisValidatorsRoot = new Uint8Array(32).fill(42);
    for (const [activationEpoch, exitEpoch, effectiveBalance] of [
      [0, Infinity, 32_000_000_000],
      [3, Infinity, 2_048_500_000_000],
      [4, Infinity, 32_000_000_000],
      [0, 3, 32_000_000_000],
      [0, 4, 33_000_000_000],
      [Infinity, Infinity, 32_000_000_000],
    ]) {
      state.validators.push(
        ssz.phase0.Validator.toViewDU({
          ...ssz.phase0.Validator.defaultValue(),
          activationEpoch,
          exitEpoch,
          effectiveBalance,
        })
      );
    }
    const bytes = state.serialize();
    const backing = Buffer.alloc(bytes.length + 17);
    backing.set(bytes, 17);
    const period = computeWeakSubjectivityPeriod(config, state);
    const deserialize = vi.spyOn(stateType, "deserializeToViewDU");

    for (const input of [bytes, backing.subarray(17)]) {
      const metadata = readBeaconStateBytesMetadata(input);
      assert(metadata !== null, `${fork}: metadata should be readable`);
      expect(metadata, fork).toEqual({
        slot: state.slot,
        genesisTime: state.genesisTime,
        genesisValidatorsRoot: state.genesisValidatorsRoot,
      });
      expect(scanActiveValidatorsFromStateBytes(input, stateType, 3), fork).toEqual({
        activeValidatorCount: 3,
        totalActiveBalanceIncrements: 32 + 2048 + 33,
      });
      const summary = computeWeakSubjectivitySummaryFromStateBytes(config, input, metadata);
      assert(summary !== null, `${fork}: weak subjectivity summary should be computable`);
      expect(summary, fork).toEqual({checkpointEpoch: 4, genesisTime: state.genesisTime, period});
      for (const [epoch, expected] of [
        [-1, true],
        [4, true],
        [4 + period, true],
        [5 + period, false],
      ] as const) {
        const now = state.genesisTime + (epoch * SLOTS_PER_EPOCH * config.SLOT_DURATION_MS) / 1000;
        expect(isWithinWeakSubjectivityPeriodFromSummary(config, summary, now), `${fork}, epoch ${epoch}`).toBe(
          expected
        );
      }
    }
    expect(deserialize).not.toHaveBeenCalled();
  });

  it.each(forkAll)("preserves zero-active-validator behavior for %s", (fork) => {
    const config = createChainForkConfig({});
    vi.spyOn(config, "getForkName").mockReturnValue(fork);
    const stateType = sszTypesFor(fork).BeaconState;
    const state = stateType.defaultViewDU();
    const bytes = state.serialize();
    const metadata = readBeaconStateBytesMetadata(bytes);
    assert(metadata !== null, `${fork}: metadata should be readable`);
    const summary = computeWeakSubjectivitySummaryFromStateBytes(config, bytes, metadata);
    assert(summary !== null, `${fork}: weak subjectivity summary should be computable`);
    expect(summary.period).toBe(computeWeakSubjectivityPeriod(config, state));
  });

  it("copies the genesis root without retaining the state buffer", () => {
    const bytes = new Uint8Array(48);
    const metadata = readBeaconStateBytesMetadata(bytes);
    assert(metadata !== null);
    bytes.fill(1);
    expect(metadata.genesisValidatorsRoot).toEqual(new Uint8Array(32));
  });

  it("returns null for truncated metadata and invalid SSZ ranges", () => {
    expect(readBeaconStateBytesMetadata(new Uint8Array(47))).toBeNull();
    const bytes = new Uint8Array(48);
    const metadata = readBeaconStateBytesMetadata(bytes);
    assert(metadata !== null);
    expect(scanActiveValidatorsFromStateBytes(bytes, ssz.phase0.BeaconState, 0)).toBeNull();
    expect(computeWeakSubjectivitySummaryFromStateBytes(createChainForkConfig({}), bytes, metadata)).toBeNull();
  });

  it("returns null for a partial validator record", () => {
    const type = ssz.phase0.BeaconState;
    const state = type.defaultViewDU();
    state.validators.push(ssz.phase0.Validator.defaultViewDU());
    const bytes = state.serialize();
    let offset = 0;
    for (const [name, field] of Object.entries(type.fields)) {
      if (name === "balances") break;
      offset += field.fixedSize ?? 4;
    }
    const view = new DataView(bytes.buffer);
    view.setUint32(offset, view.getUint32(offset, true) - 1, true);
    const metadata = readBeaconStateBytesMetadata(bytes);
    assert(metadata !== null);
    expect(scanActiveValidatorsFromStateBytes(bytes, type, 0)).toBeNull();
    expect(computeWeakSubjectivitySummaryFromStateBytes(createChainForkConfig({}), bytes, metadata)).toBeNull();
  });

  it("includes the expiry epoch and uses the current time by default", () => {
    const config = createChainForkConfig({});
    const summary = {checkpointEpoch: 4, genesisTime: 1000, period: 2};
    const firstExpiredTime = summary.genesisTime + (7 * SLOTS_PER_EPOCH * config.SLOT_DURATION_MS) / 1000;

    expect(isWithinWeakSubjectivityPeriodFromSummary(config, summary, summary.genesisTime - 1)).toBe(true);
    expect(isWithinWeakSubjectivityPeriodFromSummary(config, summary, firstExpiredTime - 1)).toBe(true);
    expect(isWithinWeakSubjectivityPeriodFromSummary(config, summary, firstExpiredTime)).toBe(false);

    vi.useFakeTimers().setSystemTime((firstExpiredTime - 1) * 1000);
    expect(isWithinWeakSubjectivityPeriodFromSummary(config, summary)).toBe(true);
    vi.setSystemTime(firstExpiredTime * 1000);
    expect(isWithinWeakSubjectivityPeriodFromSummary(config, summary)).toBe(false);
  });
});
