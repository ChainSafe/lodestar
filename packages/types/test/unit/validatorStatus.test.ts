import {describe, it, expect} from "vitest";
import {getValidatorStatus} from "../../src/utils/validatorStatus.js";
import {phase0} from "../../src/types.js";

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
