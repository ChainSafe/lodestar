import {describe, expect, it, vi} from "vitest";
import {createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {createValidatorMonitor} from "../../../src/chain/validatorMonitor.js";
import {testLogger} from "../../utils/logger.js";

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
    return {
      slot,
      epochCtx: {
        proposersPrevEpoch: null,
      },
    } as any;
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
});
