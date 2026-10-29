import {createBeaconConfig} from "@lodestar/config";
import {createCachedBeaconState, createEmptyEpochCacheImmutableData} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {afterEach, describe, expect, it} from "vitest";
import {SecretKey} from "../src/blst.js";
import bindings from "../src/index.js";
import {pubkeyCache} from "../src/pubkeys.js";

describe("attestation rewards", () => {
  const views: InstanceType<typeof bindings.BeaconStateView>[] = [];

  afterEach(() => {
    for (const view of views) view.release();
    views.length = 0;
  });

  function fixture(fork: "altair" | "bellatrix" | "electra" = "altair", leak = false, finalizes = false) {
    const stateType = ssz[fork].BeaconState;
    const value = ssz.electra.BeaconState.defaultValue();
    const validatorCount = 64;
    value.slot = 32 * (leak ? 8 : 2) + (finalizes ? 31 : 0);
    value.validators = Array.from({length: validatorCount}, (_, index) => {
      const secret = new Uint8Array(32);
      secret[31] = index + 1;
      return {
        ...ssz.phase0.Validator.defaultValue(),
        activationEligibilityEpoch: 0,
        activationEpoch: index === 2 ? 1000 : 0,
        effectiveBalance: 32_000_000_000,
        exitEpoch: Infinity,
        pubkey: SecretKey.fromBytes(secret).toPublicKey().toBytes(),
        slashed: index === 1,
        withdrawableEpoch: Infinity,
      };
    });
    value.balances = Array.from({length: validatorCount}, () => 32_000_000_000);
    value.previousEpochParticipation = Array.from({length: validatorCount}, (_, index) => (index % 4 < 2 ? 7 : 0));
    value.currentEpochParticipation = Array.from({length: validatorCount}, () => 0);
    value.inactivityScores = Array.from({length: validatorCount}, () => 1000);
    value.finalizedCheckpoint.epoch = leak ? 0 : 1;
    if (finalizes) {
      value.previousEpochParticipation.fill(7);
      value.previousEpochParticipation[3] = 0;
      value.currentEpochParticipation.fill(7);
      value.previousJustifiedCheckpoint.epoch = Math.floor(value.slot / 32) - 2;
      value.currentJustifiedCheckpoint.epoch = Math.floor(value.slot / 32) - 1;
      value.justificationBits.set(0, true);
    }
    value.currentSyncCommittee.pubkeys = Array.from(
      {length: value.currentSyncCommittee.pubkeys.length},
      (_, index) => value.validators[index % validatorCount].pubkey
    );
    value.currentSyncCommittee.aggregatePubkey = value.validators[0].pubkey;
    value.nextSyncCommittee = value.currentSyncCommittee;
    const config = createBeaconConfig(
      {
        ALTAIR_FORK_EPOCH: 0,
        BELLATRIX_FORK_EPOCH: fork === "altair" ? Infinity : 0,
        CAPELLA_FORK_EPOCH: fork === "electra" ? 0 : Infinity,
        DENEB_FORK_EPOCH: fork === "electra" ? 0 : Infinity,
        ELECTRA_FORK_EPOCH: fork === "electra" ? 0 : Infinity,
        FULU_FORK_EPOCH: Infinity,
        GLOAS_FORK_EPOCH: Infinity,
      },
      value.genesisValidatorsRoot
    );
    value.fork.currentVersion = config.getForkVersion(value.slot);
    pubkeyCache.ensureCapacity(validatorCount);
    pubkeyCache.syncPubkeys(value.validators);
    const reference = createCachedBeaconState(
      stateType.toViewDU(value),
      createEmptyEpochCacheImmutableData(config, value)
    );
    const nativeConfig = new bindings.BeaconConfig(config, value.genesisValidatorsRoot);
    const native = bindings.BeaconStateView.createFromBytes(stateType.serialize(value), nativeConfig);
    views.push(native);
    return {config, native, reference, value};
  }

  it.each(["altair", "bellatrix", "electra"] as const)("floors rewards and uses the %s quotient", (fork) => {
    for (const leak of [false, true]) {
      const {config, native, reference, value} = fixture(fork, leak);
      const root = native.hashTreeRoot();
      const rewards = native.computeAttestationsRewards();
      const base = BigInt(reference.epochCtx.baseRewardPerIncrement);
      const active = BigInt(value.validators.filter((v) => v.activationEpoch === 0).length * 32);
      const participants = BigInt(
        value.validators.filter((v, i) => !v.slashed && value.previousEpochParticipation[i] === 7).length * 32
      );
      const quotient = fork === "altair" ? 3n * 2n ** 24n : 2n ** 24n;
      const expectedIdeal = rewards.idealRewards.map((_, increment) => ({
        effectiveBalance: increment * 1_000_000_000,
        head: leak ? 0 : Number((BigInt(increment) * base * 14n * participants) / (active * 64n)),
        inactivity: 0,
        inclusionDelay: 0,
        source: leak ? 0 : Number((BigInt(increment) * base * 14n * participants) / (active * 64n)),
        target: leak ? 0 : Number((BigInt(increment) * base * 26n * participants) / (active * 64n)),
      }));
      expect(rewards.idealRewards).toEqual(expectedIdeal);
      expect(rewards.idealRewards).toHaveLength(fork === "electra" ? 2049 : 33);
      expect(rewards.totalRewards).toEqual(
        value.validators.flatMap((validator, validatorIndex) => {
          if (validator.activationEpoch !== 0) return [];
          const participates = !validator.slashed && value.previousEpochParticipation[validatorIndex] === 7;
          return [
            {
              head: participates ? expectedIdeal[32].head : 0,
              inactivity: participates
                ? 0
                : -Number(
                    (32_000_000_000n *
                      BigInt(
                        1000 + config.INACTIVITY_SCORE_BIAS - (leak ? 0 : config.INACTIVITY_SCORE_RECOVERY_RATE)
                      )) /
                      (BigInt(config.INACTIVITY_SCORE_BIAS) * quotient)
                  ),
              inclusionDelay: 0,
              source: participates ? expectedIdeal[32].source : -Number((32n * base * 14n) / 64n),
              target: participates ? expectedIdeal[32].target : -Number((32n * base * 26n) / 64n),
              validatorIndex,
            },
          ];
        })
      );
      expect(native.hashTreeRoot()).toEqual(root);
    }
  });

  it("ends a leak before computing attestation rewards", () => {
    const {config, native} = fixture("altair", true, true);
    const root = native.hashTreeRoot();
    const rewards = native.computeAttestationsRewards([0, 3]);
    const quotient = 3n * 2n ** 24n;
    const updatedScore = 1000 + config.INACTIVITY_SCORE_BIAS - config.INACTIVITY_SCORE_RECOVERY_RATE;
    expect(rewards.idealRewards[32].source).toBeGreaterThan(0);
    expect(rewards.totalRewards[0].source).toBeGreaterThan(0);
    expect(rewards.totalRewards[1].inactivity).toBe(
      -Number((32_000_000_000n * BigInt(updatedScore)) / (BigInt(config.INACTIVITY_SCORE_BIAS) * quotient))
    );
    expect(native.hashTreeRoot()).toEqual(root);
    expect(native.computeAttestationsRewards([0, 3])).toEqual(rewards);
  });

  it("includes the Electra ideal balance range", () => {
    const {native} = fixture("electra");
    const rewards = native.computeAttestationsRewards([0]);
    expect(rewards.idealRewards).toHaveLength(2049);
    expect(rewards.idealRewards[2048].effectiveBalance).toBe(2_048_000_000_000);
    expect(rewards.totalRewards).toHaveLength(1);
  });

  it("sorts and deduplicates selection while accepting mixed-case and unprefixed pubkeys", () => {
    const {native, value} = fixture();
    const hex = Buffer.from(value.validators[0].pubkey).toString("hex");
    const filters = [3, hex.toUpperCase(), `0x${hex}`, 3];
    const all = native.computeAttestationsRewards();
    expect(native.computeAttestationsRewards(filters)).toEqual({
      idealRewards: all.idealRewards,
      totalRewards: all.totalRewards.filter((reward) => reward.validatorIndex === 0 || reward.validatorIndex === 3),
    });
    expect(native.computeAttestationsRewards([`0x${"00".repeat(48)}`]).totalRewards).toEqual([]);
    expect(native.computeAttestationsRewards([]).totalRewards).toHaveLength(63);
  });

  it("rejects malformed hexadecimal filters", () => {
    const {native} = fixture();
    expect(() => native.computeAttestationsRewards(["0xabc"])).toThrow("hex string length 3 must be multiple of 2");
    expect(() => native.computeAttestationsRewards(["0xzz"])).toThrow("hex string contains invalid characters");
  });

  it("rejects Phase0 before reading validator filters", () => {
    const value = ssz.phase0.BeaconState.defaultValue();
    const config = createBeaconConfig({ALTAIR_FORK_EPOCH: Infinity}, value.genesisValidatorsRoot);
    const nativeConfig = new bindings.BeaconConfig(config, value.genesisValidatorsRoot);
    const native = bindings.BeaconStateView.createFromBytes(ssz.phase0.BeaconState.serialize(value), nativeConfig);
    views.push(native);
    expect(() => native.computeAttestationsRewards()).toThrow("AttestationsRewardsUnsupportedFork");
  });

  it("retains the active call when a filter getter releases the state", () => {
    const {native} = fixture();
    const ids = [0];
    Object.defineProperty(ids, "0", {
      get() {
        native.release();
        return 0;
      },
    });
    const expected = native.computeAttestationsRewards([0]);
    expect(native.computeAttestationsRewards(ids)).toEqual(expected);
    expect(() => native.computeAttestationsRewards()).toThrow("InvalidState");
  });

  it("preserves thrown getter errors", () => {
    const {native} = fixture();
    const failure = new Error("filter getter failed");
    const ids = [0];
    Object.defineProperty(ids, "0", {
      get() {
        throw failure;
      },
    });
    expect(() => native.computeAttestationsRewards(ids)).toThrow(failure);
  });

  it("keeps owned results valid when output setters release the state", () => {
    const {native} = fixture();
    const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, "head");
    let calls = 0;
    Object.defineProperty(Object.prototype, "head", {
      configurable: true,
      set(head: number) {
        calls++;
        native.release();
        Object.defineProperty(this, "head", {configurable: true, enumerable: true, value: head});
      },
    });
    let result: ReturnType<typeof native.computeAttestationsRewards>;
    try {
      result = native.computeAttestationsRewards([0]);
    } finally {
      if (descriptor) Object.defineProperty(Object.prototype, "head", descriptor);
      else Reflect.deleteProperty(Object.prototype, "head");
    }
    expect(calls).toBe(34);
    expect(result.totalRewards[0].validatorIndex).toBe(0);
    expect(result.totalRewards[0].head).toBeGreaterThan(0);
  });
});
