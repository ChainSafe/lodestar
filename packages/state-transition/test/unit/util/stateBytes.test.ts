import {afterEach, assert, describe, expect, it, vi} from "vitest";
import {createBeaconConfig, createChainForkConfig} from "@lodestar/config";
import {SLOTS_PER_EPOCH, forkAll} from "@lodestar/params";
import {ssz, sszTypesFor} from "@lodestar/types";
import {
  getValidatorCountFromStateBytes,
  getValidatorPubkeyFromStateBytes,
  readBeaconStateBytesMetadata,
  scanActiveValidatorsFromStateBytes,
} from "../../../src/util/sszBytes.js";
import {
  computeWeakSubjectivityPeriod,
  computeWeakSubjectivitySummaryFromStateBytes,
  isWithinWeakSubjectivityPeriodFromSummary,
} from "../../../src/util/weakSubjectivity.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("scanActiveValidatorsFromStateBytes", () => {
  it.each(forkAll)("scans the registry with populated surrounding fields for %s", (fork) => {
    const stateType = sszTypesFor(fork).BeaconState;
    const state = stateType.defaultViewDU();
    const largeEpoch = 2 ** 32 + 3;
    state.historicalRoots.push(new Uint8Array(32).fill(0xa5));
    state.eth1DataVotes.push(ssz.phase0.Eth1Data.defaultViewDU());
    for (const [activationEpoch, exitEpoch, effectiveBalance, slashed] of [
      [0, Infinity, 32_000_000_000, false],
      [3, 4, 2_048_600_000_000, true],
      [3, 4, 33_600_000_000, false],
      [4, 5, 0, false],
      [Infinity, Infinity, 32_000_000_000, false],
      [largeEpoch, largeEpoch + 2, 65_000_000_000, false],
      [0, 3, 8_000_000_000, false],
      [3, 3, 50_000_000_000, false],
    ] as const) {
      state.validators.push(
        ssz.phase0.Validator.toViewDU({
          ...ssz.phase0.Validator.defaultValue(),
          activationEpoch,
          exitEpoch,
          effectiveBalance,
          slashed,
        })
      );
      state.balances.push(999_000_000_000);
    }
    const bytes = state.serialize();
    for (const [epoch, activeValidatorCount, totalActiveBalanceIncrements] of [
      [0, 2, 40], // Active indices: 0, 6. Balance increments: 32 + 8.
      [2, 2, 40], // Active indices: 0, 6. Validator 6 has not exited yet.
      [3, 3, 2113], // Active indices: 0, 1 (slashed), 2. Validator 6 exits; validator 7 is never active.
      [4, 2, 32], // Active indices: 0, 3 (zero balance). Validators 1 and 2 exit.
      [5, 1, 32], // Active index: 0. Validator 3 exits.
      [largeEpoch - 1, 1, 32], // Active index: 0. Validator 5 has not activated yet.
      [largeEpoch, 2, 97], // Active indices: 0, 5. Validator 5 activates; balance increments: 32 + 65.
      [largeEpoch + 1, 2, 97], // Active indices: 0, 5. Validator 5 has not exited yet.
      [largeEpoch + 2, 1, 32], // Active index: 0. Validator 5 exits.
    ]) {
      expect(scanActiveValidatorsFromStateBytes(bytes, stateType, epoch), `${fork}, epoch ${epoch}`).toEqual({
        activeValidatorCount,
        totalActiveBalanceIncrements,
      });
    }
  });

  it.each([
    {name: "empty registry", validators: [], activeValidatorCount: 0},
    {
      name: "only inactive validators",
      validators: [
        {activationEpoch: 4, exitEpoch: Infinity, effectiveBalance: 32_000_000_000},
        {activationEpoch: 0, exitEpoch: 3, effectiveBalance: 32_000_000_000},
      ],
      activeValidatorCount: 0,
    },
    {
      name: "zero active balance",
      validators: [{activationEpoch: 0, exitEpoch: Infinity, effectiveBalance: 0}],
      activeValidatorCount: 1,
    },
    {
      name: "active balances below one increment",
      validators: [
        {activationEpoch: 0, exitEpoch: Infinity, effectiveBalance: 900_000_000},
        {activationEpoch: 0, exitEpoch: Infinity, effectiveBalance: 900_000_000},
        {activationEpoch: 0, exitEpoch: Infinity, effectiveBalance: 900_000_000},
      ],
      activeValidatorCount: 3,
    },
  ])("preserves the validator count and minimum balance for $name", ({validators, activeValidatorCount}) => {
    const stateType = ssz.phase0.BeaconState;
    const state = stateType.defaultViewDU();
    for (const validator of validators) {
      state.validators.push(ssz.phase0.Validator.toViewDU({...ssz.phase0.Validator.defaultValue(), ...validator}));
    }
    expect(scanActiveValidatorsFromStateBytes(state.serialize(), stateType, 3)).toEqual({
      activeValidatorCount,
      totalActiveBalanceIncrements: 1,
    });
  });

  it.each(forkAll)("returns null for malformed registry ranges in %s", (fork) => {
    const stateType = ssz[fork].BeaconState;
    const state = stateType.defaultViewDU();
    state.validators.push(ssz.phase0.Validator.defaultViewDU());
    state.balances.push(32_000_000_000);
    const bytes = state.serialize();
    const fieldOffsets: Record<string, number> = {};
    let fixedEnd = 0;
    for (const [name, field] of Object.entries(stateType.fields)) {
      fieldOffsets[name] = fixedEnd;
      fixedEnd += field.fixedSize ?? ssz.Uint32.fixedSize;
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const validatorStart = view.getUint32(fieldOffsets.validators, true);
    const validatorEnd = view.getUint32(fieldOffsets.balances, true);
    const malformedInputs: [string, Uint8Array][] = [
      ["empty state", bytes.subarray(0, 0)],
      ["truncated fixed section", bytes.subarray(0, fixedEnd - 1)],
    ];
    for (const [name, field, offset] of [
      ["wrong first offset", "historicalRoots", fixedEnd + 1],
      ["validator offset before preceding field", "validators", validatorStart - 1],
      ["validator offset past end", "validators", bytes.length + 1],
      ["balances offset before validators", "balances", validatorStart - 1],
      ["balances offset past end", "balances", bytes.length + 1],
      ["partial validator record", "balances", validatorEnd - 1],
    ] as const) {
      const malformed = bytes.slice();
      new DataView(malformed.buffer, malformed.byteOffset, malformed.byteLength).setUint32(
        fieldOffsets[field],
        offset,
        true
      );
      malformedInputs.push([name, malformed]);
    }
    for (const [name, input] of malformedInputs) {
      expect(scanActiveValidatorsFromStateBytes(input, stateType, 0), `${fork}: ${name}`).toBeNull();
    }
  });
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
    expect(getValidatorCountFromStateBytes(createChainForkConfig({}), bytes)).toBeNull();
    expect(computeWeakSubjectivitySummaryFromStateBytes(createChainForkConfig({}), bytes, metadata)).toBeNull();
  });

  it("reads the validator count", () => {
    const state = ssz.phase0.BeaconState.defaultViewDU();
    for (let i = 0; i < 3; i++) state.validators.push(ssz.phase0.Validator.defaultViewDU());
    expect(getValidatorCountFromStateBytes(createChainForkConfig({}), state.serialize())).toBe(3);
  });

  it("reads validator pubkeys", () => {
    const config = createChainForkConfig({});
    const state = ssz.phase0.BeaconState.defaultViewDU();
    for (let i = 0; i < 3; i++) {
      state.validators.push(
        ssz.phase0.Validator.toViewDU({...ssz.phase0.Validator.defaultValue(), pubkey: new Uint8Array(48).fill(i + 1)})
      );
    }
    const bytes = state.serialize();
    for (let i = 0; i < 3; i++) {
      expect(getValidatorPubkeyFromStateBytes(config, bytes, i), `wrong pubkey at index ${i}`).toEqual(
        new Uint8Array(48).fill(i + 1)
      );
    }
    expect(getValidatorPubkeyFromStateBytes(config, bytes, 3)).toBeNull();
    expect(getValidatorPubkeyFromStateBytes(config, bytes, -1)).toBeNull();
    expect(getValidatorPubkeyFromStateBytes(config, new Uint8Array(48), 0)).toBeNull();
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
    expect(getValidatorCountFromStateBytes(createChainForkConfig({}), bytes)).toBeNull();
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
