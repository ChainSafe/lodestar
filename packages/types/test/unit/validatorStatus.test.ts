import {describe, expect, it} from "vitest";
import {phase0} from "../../src/types.js";
import {
  GeneralValidatorStatus,
  ValidatorStatus,
  getValidatorStatus,
  statusMatches,
} from "../../src/utils/validatorStatus.js";

describe("getValidatorStatus", () => {
  it("should return PENDING_INITIALIZED", () => {
    const validator = {
      activationEpoch: 1,
      activationEligibilityEpoch: Infinity,
    } as phase0.Validator;
    const currentEpoch = 0;
    const status = getValidatorStatus(validator, currentEpoch);
    expect(status).toBe("pending_initialized");
  });
  it("should return PENDING_QUEUED", () => {
    const validator = {
      activationEpoch: 1,
      activationEligibilityEpoch: 101010101101010,
    } as phase0.Validator;
    const currentEpoch = 0;
    const status = getValidatorStatus(validator, currentEpoch);
    expect(status).toBe("pending_queued");
  });
  it("should return ACTIVE_ONGOING", () => {
    const validator = {
      activationEpoch: 1,
      exitEpoch: Infinity,
    } as phase0.Validator;
    const currentEpoch = 1;
    const status = getValidatorStatus(validator, currentEpoch);
    expect(status).toBe("active_ongoing");
  });
  it("should return ACTIVE_SLASHED", () => {
    const validator = {
      activationEpoch: 1,
      exitEpoch: 101010101101010,
      slashed: true,
    } as phase0.Validator;
    const currentEpoch = 1;
    const status = getValidatorStatus(validator, currentEpoch);
    expect(status).toBe("active_slashed");
  });
  it("should return ACTIVE_EXITING", () => {
    const validator = {
      activationEpoch: 1,
      exitEpoch: 101010101101010,
      slashed: false,
    } as phase0.Validator;
    const currentEpoch = 1;
    const status = getValidatorStatus(validator, currentEpoch);
    expect(status).toBe("active_exiting");
  });
  it("should return EXITED_SLASHED", () => {
    const validator = {
      exitEpoch: 1,
      withdrawableEpoch: 3,
      slashed: true,
    } as phase0.Validator;
    const currentEpoch = 2;
    const status = getValidatorStatus(validator, currentEpoch);
    expect(status).toBe("exited_slashed");
  });
  it("should return EXITED_UNSLASHED", () => {
    const validator = {
      exitEpoch: 1,
      withdrawableEpoch: 3,
      slashed: false,
    } as phase0.Validator;
    const currentEpoch = 2;
    const status = getValidatorStatus(validator, currentEpoch);
    expect(status).toBe("exited_unslashed");
  });
  it("should return WITHDRAWAL_POSSIBLE", () => {
    const validator = {
      withdrawableEpoch: 1,
      effectiveBalance: 32,
    } as phase0.Validator;
    const currentEpoch = 1;
    const status = getValidatorStatus(validator, currentEpoch);
    expect(status).toBe("withdrawal_possible");
  });
  it("should return WITHDRAWAL_DONE", () => {
    const validator = {
      withdrawableEpoch: 1,
      effectiveBalance: 0,
    } as phase0.Validator;
    const currentEpoch = 1;
    const status = getValidatorStatus(validator, currentEpoch);
    expect(status).toBe("withdrawal_done");
  });
  it("should error", () => {
    const validator = {} as phase0.Validator;
    const currentEpoch = 0;
    try {
      getValidatorStatus(validator, currentEpoch);
    } catch (error) {
      expect(error).toHaveProperty("message", "ValidatorStatus unknown");
    }
  });
});

describe("statusMatches", () => {
  const groupMembers: Record<GeneralValidatorStatus, ValidatorStatus[]> = {
    active: ["active_ongoing", "active_exiting", "active_slashed"],
    pending: ["pending_initialized", "pending_queued"],
    exited: ["exited_unslashed", "exited_slashed"],
    withdrawal: ["withdrawal_possible", "withdrawal_done"],
  };

  for (const [group, members] of Object.entries(groupMembers) as [GeneralValidatorStatus, ValidatorStatus[]][]) {
    it(`group status "${group}" matches its fine-grained members`, () => {
      for (const member of members) {
        expect(statusMatches([group], member), `${group} should match ${member}`).toBe(true);
      }
    });
  }

  it("fine-grained statuses still match exactly", () => {
    expect(statusMatches(["active_ongoing"], "active_ongoing")).toBe(true);
    expect(statusMatches(["active_ongoing"], "active_exiting")).toBe(false);
    expect(statusMatches(["active_ongoing"], "pending_queued")).toBe(false);
  });

  it("does not match unrelated group statuses", () => {
    expect(statusMatches(["pending"], "active_ongoing")).toBe(false);
    expect(statusMatches(["exited"], "active_ongoing")).toBe(false);
    expect(statusMatches(["withdrawal"], "active_ongoing")).toBe(false);
  });

  it("matches when filter contains either fine-grained or group status", () => {
    expect(statusMatches(["pending", "active"], "active_ongoing")).toBe(true);
    expect(statusMatches(["pending", "active_ongoing"], "active_ongoing")).toBe(true);
  });
});
