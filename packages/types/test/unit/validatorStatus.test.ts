import {describe, it, expect} from "vitest";
import {getValidatorStatus} from "../../src/utils/validatorStatus.js";
import {phase0} from "../../src/types.js";

describe("getValidatorStatus", function () {
  it("should return PENDING_INITIALIZED", function () {
    const validator = {
      activationEpoch: 1,
      activationEligibilityEpoch: Infinity,
    } as phase0.Validator;
    const currentEpoch = 0;
    const status = getValidatorStatus(validator, currentEpoch);
    expect(status).toBe("pending_initialized");
  });
  it("should return PENDING_QUEUED", function () {
    const validator = {
      activationEpoch: 1,
      activationEligibilityEpoch: 101010101101010,
    } as phase0.Validator;
    const currentEpoch = 0;
    const status = getValidatorStatus(validator, currentEpoch);
    expect(status).toBe("pending_queued");
  });
  it("should return ACTIVE_ONGOING", function () {
    const validator = {
      activationEpoch: 1,
      exitEpoch: Infinity,
    } as phase0.Validator;
    const currentEpoch = 1;
    const status = getValidatorStatus(validator, currentEpoch);
    expect(status).toBe("active_ongoing");
  });
  it("should return ACTIVE_SLASHED", function () {
    const validator = {
      activationEpoch: 1,
      exitEpoch: 101010101101010,
      slashed: true,
    } as phase0.Validator;
    const currentEpoch = 1;
    const status = getValidatorStatus(validator, currentEpoch);
    expect(status).toBe("active_slashed");
  });
  it("should return ACTIVE_EXITING", function () {
    const validator = {
      activationEpoch: 1,
      exitEpoch: 101010101101010,
      slashed: false,
    } as phase0.Validator;
    const currentEpoch = 1;
    const status = getValidatorStatus(validator, currentEpoch);
    expect(status).toBe("active_exiting");
  });
  it("should return EXITED_SLASHED", function () {
    const validator = {
      exitEpoch: 1,
      withdrawableEpoch: 3,
      slashed: true,
    } as phase0.Validator;
    const currentEpoch = 2;
    const status = getValidatorStatus(validator, currentEpoch);
    expect(status).toBe("exited_slashed");
  });
  it("should return EXITED_UNSLASHED", function () {
    const validator = {
      exitEpoch: 1,
      withdrawableEpoch: 3,
      slashed: false,
    } as phase0.Validator;
    const currentEpoch = 2;
    const status = getValidatorStatus(validator, currentEpoch);
    expect(status).toBe("exited_unslashed");
  });
  it("should return WITHDRAWAL_POSSIBLE", function () {
    const validator = {
      withdrawableEpoch: 1,
      effectiveBalance: 32,
    } as phase0.Validator;
    const currentEpoch = 1;
    const status = getValidatorStatus(validator, currentEpoch);
    expect(status).toBe("withdrawal_possible");
  });
  it("should return WITHDRAWAL_DONE", function () {
    const validator = {
      withdrawableEpoch: 1,
      effectiveBalance: 0,
    } as phase0.Validator;
    const currentEpoch = 1;
    const status = getValidatorStatus(validator, currentEpoch);
    expect(status).toBe("withdrawal_done");
  });
  it("should error", function () {
    const validator = {} as phase0.Validator;
    const currentEpoch = 0;
    try {
      getValidatorStatus(validator, currentEpoch);
    } catch (error) {
      expect(error).toHaveProperty("message", "ValidatorStatus unknown");
    }
  });
});
