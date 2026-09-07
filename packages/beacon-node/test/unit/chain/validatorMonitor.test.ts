import {MetricValueWithName} from "prom-client";
import {describe, expect, it, vi} from "vitest";
import {pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {createBeaconConfig, createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {testLogger} from "@lodestar/logger/test-utils";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {BeaconStateView, createCachedBeaconState} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {ValidatorMonitor, createValidatorMonitor} from "../../../src/chain/validatorMonitor.js";
import {RegistryMetricCreator} from "../../../src/metrics/index.js";

describe("ValidatorMonitor", () => {
  // Use phase0 config (no altair) to avoid needing full state with block roots
  const config = createChainForkConfig({
    ...defaultChainConfig,
    ALTAIR_FORK_EPOCH: Infinity,
    BELLATRIX_FORK_EPOCH: Infinity,
    CAPELLA_FORK_EPOCH: Infinity,
    DENEB_FORK_EPOCH: Infinity,
    ELECTRA_FORK_EPOCH: Infinity,
  });

  const genesisTime = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
  const logger = testLogger("validatorMonitor");

  // Helper to create a minimal mock head state for phase0
  function createMockHeadState(slot: number) {
    const state = ssz.fulu.BeaconState.defaultViewDU();
    state.slot = slot;
    const cachedState = createCachedBeaconState(state, {
      config: createBeaconConfig(defaultChainConfig, state.genesisValidatorsRoot),
      pubkeyCache,
    });
    expect(cachedState.epochCtx.proposersPrevEpoch).toBeNull();
    return new BeaconStateView(cachedState);
  }

  describe("registerLocalValidator", () => {
    it("should register new validators and track them", () => {
      const monitor = createValidatorMonitor(null, config, genesisTime, logger, {});

      monitor.registerLocalValidator(1);
      monitor.registerLocalValidator(2);
      monitor.registerLocalValidator(3);

      const indices = monitor.getMonitoredValidatorIndices();
      expect(indices).toHaveLength(3);
      expect(indices).toContain(1);
      expect(indices).toContain(2);
      expect(indices).toContain(3);
    });

    it("should not duplicate validators on re-registration", () => {
      const monitor = createValidatorMonitor(null, config, genesisTime, logger, {});

      monitor.registerLocalValidator(1);
      monitor.registerLocalValidator(1); // Register again

      const indices = monitor.getMonitoredValidatorIndices();
      expect(indices).toHaveLength(1);
      expect(indices).toContain(1);
    });
  });

  describe("onceEveryEndOfEpoch pruning", () => {
    it("should prune validators not seen within retain period", () => {
      const monitor = createValidatorMonitor(null, config, genesisTime, logger, {});

      // Register a validator
      monitor.registerLocalValidator(1);
      expect(monitor.getMonitoredValidatorIndices()).toContain(1);

      // Create a mock head state
      const slot = SLOTS_PER_EPOCH * 2; // End of epoch 1
      const headState = createMockHeadState(slot);

      // Mock Date.now to be far in the future (beyond retain period)
      const originalDateNow = Date.now;
      const retainMs = SLOTS_PER_EPOCH * config.SLOT_DURATION_MS * 2;
      vi.spyOn(Date, "now").mockReturnValue(originalDateNow() + retainMs + 1000);

      // Call onceEveryEndOfEpoch - this should prune the validator
      monitor.onceEveryEndOfEpoch(headState);

      // Validator should be pruned
      expect(monitor.getMonitoredValidatorIndices()).not.toContain(1);

      // Restore Date.now
      vi.restoreAllMocks();
    });

    it("should not prune validators within retain period", () => {
      const monitor = createValidatorMonitor(null, config, genesisTime, logger, {});

      // Register a validator
      monitor.registerLocalValidator(1);
      expect(monitor.getMonitoredValidatorIndices()).toContain(1);

      // Create a mock head state
      const slot = SLOTS_PER_EPOCH * 2;
      const headState = createMockHeadState(slot);

      // Call onceEveryEndOfEpoch without mocking time (validator was just registered)
      monitor.onceEveryEndOfEpoch(headState);

      // Validator should still be there
      expect(monitor.getMonitoredValidatorIndices()).toContain(1);
    });

    it("should not prune re-registered validators even after initial retain period", () => {
      const monitor = createValidatorMonitor(null, config, genesisTime, logger, {});
      const retainMs = SLOTS_PER_EPOCH * config.SLOT_DURATION_MS * 2;
      const baseTime = Date.now();

      // Register a validator at initial time
      vi.spyOn(Date, "now").mockReturnValue(baseTime);
      monitor.registerLocalValidator(1);
      expect(monitor.getMonitoredValidatorIndices()).toContain(1);

      // Advance time past the retain period, but re-register the validator before pruning
      vi.spyOn(Date, "now").mockReturnValue(baseTime + retainMs + 1000);
      monitor.registerLocalValidator(1); // Re-register updates lastRegisteredTimeMs

      // Create a mock head state
      const slot = SLOTS_PER_EPOCH * 2;
      const headState = createMockHeadState(slot);

      // Call onceEveryEndOfEpoch - validator should NOT be pruned due to re-registration
      monitor.onceEveryEndOfEpoch(headState);

      // Validator should still be there because re-registration updated the timestamp
      expect(monitor.getMonitoredValidatorIndices()).toContain(1);

      vi.restoreAllMocks();
    });
  });
  describe("onceEveryEndOfEpoch on-chain attestation metrics", () => {
    // Hook runs on the last slot of epoch 2, so it summarizes epoch 1
    const headSlot = SLOTS_PER_EPOCH * 2;
    const prevEpochSlot = SLOTS_PER_EPOCH + 8;

    function createMonitorWithMetrics(): {register: RegistryMetricCreator; monitor: ValidatorMonitor} {
      const register = new RegistryMetricCreator();
      const monitor = createValidatorMonitor(register, config, genesisTime, logger, {});
      return {register, monitor};
    }

    async function metricValue(
      register: RegistryMetricCreator,
      name: string,
      suffix?: "count" | "sum"
    ): Promise<number> {
      const metric = register.getSingleMetric(name);
      if (!metric) throw Error(`metric ${name} not registered`);
      const {values} = await metric.get();
      const value = suffix
        ? (values as MetricValueWithName<string>[]).find((v) => v.metricName === `${name}_${suffix}`)
        : values[0];
      return value?.value ?? 0;
    }

    function includeAttestation(monitor: ValidatorMonitor, validatorIndex: number, correctHead: boolean): void {
      const attestation = ssz.phase0.IndexedAttestation.defaultValue();
      attestation.attestingIndices = [validatorIndex];
      attestation.data.slot = prevEpochSlot;
      attestation.data.target.epoch = 1;
      // parentSlot === data.slot gives inclusion distance 1
      monitor.registerAttestationInBlock(attestation, prevEpochSlot, correctHead, false, "0x00", prevEpochSlot + 1);
    }

    it("records hit, correct head and inclusion distance for an included attestation", async () => {
      const {register, monitor} = createMonitorWithMetrics();
      monitor.registerLocalValidator(1);
      includeAttestation(monitor, 1, true);

      monitor.onceEveryEndOfEpoch(createMockHeadState(headSlot));

      expect(await metricValue(register, "validator_monitor_prev_epoch_on_chain_attester_hit_total")).toBe(1);
      expect(await metricValue(register, "validator_monitor_prev_epoch_on_chain_attester_miss_total")).toBe(0);
      expect(await metricValue(register, "validator_monitor_prev_epoch_on_chain_attester_correct_head_total")).toBe(1);
      expect(await metricValue(register, "validator_monitor_prev_epoch_on_chain_attester_incorrect_head_total")).toBe(
        0
      );
      expect(await metricValue(register, "validator_monitor_prev_epoch_on_chain_inclusion_distance", "count")).toBe(1);
      expect(await metricValue(register, "validator_monitor_prev_epoch_on_chain_inclusion_distance", "sum")).toBe(1);
    });

    it("records incorrect head for an included attestation with wrong head vote", async () => {
      const {register, monitor} = createMonitorWithMetrics();
      monitor.registerLocalValidator(1);
      includeAttestation(monitor, 1, false);

      monitor.onceEveryEndOfEpoch(createMockHeadState(headSlot));

      expect(await metricValue(register, "validator_monitor_prev_epoch_on_chain_attester_correct_head_total")).toBe(0);
      expect(await metricValue(register, "validator_monitor_prev_epoch_on_chain_attester_incorrect_head_total")).toBe(
        1
      );
    });

    it("records a miss and no head vote for a validator with no included attestation", async () => {
      const {register, monitor} = createMonitorWithMetrics();
      monitor.registerLocalValidator(2);

      monitor.onceEveryEndOfEpoch(createMockHeadState(headSlot));

      expect(await metricValue(register, "validator_monitor_prev_epoch_on_chain_attester_hit_total")).toBe(0);
      expect(await metricValue(register, "validator_monitor_prev_epoch_on_chain_attester_miss_total")).toBe(1);
      expect(await metricValue(register, "validator_monitor_prev_epoch_on_chain_attester_correct_head_total")).toBe(0);
      expect(await metricValue(register, "validator_monitor_prev_epoch_on_chain_attester_incorrect_head_total")).toBe(
        0
      );
      expect(await metricValue(register, "validator_monitor_prev_epoch_on_chain_inclusion_distance", "count")).toBe(0);
    });

    it("does not count the same epoch twice", async () => {
      const {register, monitor} = createMonitorWithMetrics();
      monitor.registerLocalValidator(1);
      includeAttestation(monitor, 1, true);

      monitor.onceEveryEndOfEpoch(createMockHeadState(headSlot));
      monitor.onceEveryEndOfEpoch(createMockHeadState(headSlot));

      expect(await metricValue(register, "validator_monitor_prev_epoch_on_chain_attester_hit_total")).toBe(1);
      expect(await metricValue(register, "validator_monitor_prev_epoch_on_chain_attester_correct_head_total")).toBe(1);
      expect(await metricValue(register, "validator_monitor_prev_epoch_on_chain_inclusion_distance", "count")).toBe(1);
    });

    it("registerValidatorStatuses does not record on-chain attestation metrics", async () => {
      const {register, monitor} = createMonitorWithMetrics();
      monitor.registerLocalValidator(1);
      includeAttestation(monitor, 1, true);

      // Epoch transition 2 -> 3 summarizes epoch 1, the same epoch onceEveryEndOfEpoch handles
      monitor.registerValidatorStatuses(2, [], [], [], []);

      expect(await metricValue(register, "validator_monitor_prev_epoch_on_chain_attester_hit_total")).toBe(0);
      expect(await metricValue(register, "validator_monitor_prev_epoch_on_chain_attester_miss_total")).toBe(0);
      expect(await metricValue(register, "validator_monitor_prev_epoch_on_chain_attester_correct_head_total")).toBe(0);
      expect(await metricValue(register, "validator_monitor_prev_epoch_on_chain_inclusion_distance", "count")).toBe(0);
    });
  });
});
