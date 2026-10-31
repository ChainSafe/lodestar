import {beforeEach, describe, expect, it} from "vitest";
import {
  COMPOUNDING_WITHDRAWAL_PREFIX,
  EFFECTIVE_BALANCE_INCREMENT,
  ETH1_ADDRESS_WITHDRAWAL_PREFIX,
  ForkSeq,
  MAX_EFFECTIVE_BALANCE_ELECTRA,
  MIN_ACTIVATION_BALANCE,
  SWEEP_THRESHOLD_CREDENTIAL_OFFSET,
} from "@lodestar/params";
import {phase0, ssz} from "@lodestar/types";
import {generateState} from "../../../src/testUtils/state.js";
import {
  getActiveValidatorIndices,
  getSweepThreshold,
  getSweepThresholdIncrements,
  isActiveValidator,
  isPartiallyWithdrawableValidator,
  isSlashableValidator,
  withSweepThreshold,
} from "../../../src/util/index.js";
import {randBetween} from "../../utils/misc.js";
import {generateValidator} from "../../utils/validator.js";

describe("getActiveValidatorIndices", () => {
  it("empty list of validators should return no indices (empty list)", () => {
    expect(getActiveValidatorIndices(generateState(), randBetween(0, 4))).toStrictEqual(new Uint32Array([]));
  });
  it("list of cloned validators should return all or none", () => {
    const state = generateState();
    const activationEpoch = 1;
    const exitEpoch = 10;
    state.validators = ssz.phase0.Validators.toViewDU(
      Array.from({length: 10}, () => generateValidator({activation: activationEpoch, exit: exitEpoch}))
    );

    const allActiveIndices = new Uint32Array(state.validators.getAllReadonlyValues().map((_, i) => i));
    const allInactiveIndices: any = new Uint32Array([]);
    expect(getActiveValidatorIndices(state, activationEpoch)).toStrictEqual(allActiveIndices);
    expect(getActiveValidatorIndices(state, exitEpoch)).toStrictEqual(allInactiveIndices);
  });
});

describe("isActiveValidator", () => {
  const testValues = [
    {validatorOpts: {activation: 0, exit: 100}, epoch: 0, expected: true},
    {validatorOpts: {activation: 10, exit: 101}, epoch: 100, expected: true},
    {validatorOpts: {activation: 100, exit: 1000}, epoch: 100, expected: true},
    {validatorOpts: {activation: 1}, epoch: 0, expected: false},
    {validatorOpts: {activation: 100}, epoch: 5, expected: false},
    {validatorOpts: {activation: 1, exit: 5}, epoch: 100, expected: false},
  ];

  for (const testValue of testValues) {
    it(`should be ${testValue.expected ? "" : "not "}active`, () => {
      const v: phase0.Validator = generateValidator(testValue.validatorOpts);
      const result: boolean = isActiveValidator(v, testValue.epoch);
      expect(result).toBe(testValue.expected);
    });
  }
});

describe("isSlashableValidator", () => {
  let validator: phase0.Validator;

  beforeEach(() => {
    validator = generateValidator();
  });

  it("should check validator.slashed", () => {
    validator.activationEpoch = 0;
    validator.withdrawableEpoch = Infinity;
    validator.slashed = false;
    expect(isSlashableValidator(validator, 0)).toBeWithMessage(true, "unslashed validator should be slashable");
    validator.slashed = true;
    expect(!isSlashableValidator(validator, 0)).toBeWithMessage(true, "slashed validator should not be slashable");
  });
  it("should check validator.activationEpoch", () => {
    validator.activationEpoch = 10;
    validator.withdrawableEpoch = Infinity;
    expect(!isSlashableValidator(validator, validator.activationEpoch - 1)).toBeWithMessage(
      true,
      "unactivated validator should not be slashable"
    );
    expect(isSlashableValidator(validator, validator.activationEpoch)).toBeWithMessage(
      true,
      "activated validator should be slashable"
    );
  });
  it("should check validator.withdrawableEpoch", () => {
    validator.activationEpoch = 0;
    validator.withdrawableEpoch = 10;
    expect(isSlashableValidator(validator, validator.withdrawableEpoch - 1)).toBeWithMessage(
      true,
      "nonwithdrawable validator should be slashable"
    );
    expect(!isSlashableValidator(validator, validator.withdrawableEpoch)).toBeWithMessage(
      true,
      "withdrawable validator should not be slashable"
    );
  });
});

describe("getSweepThreshold", () => {
  const compounding = (increments: number): Uint8Array => {
    const credentials = new Uint8Array(32);
    credentials[0] = COMPOUNDING_WITHDRAWAL_PREFIX;
    credentials[SWEEP_THRESHOLD_CREDENTIAL_OFFSET] = increments & 0xff;
    credentials[SWEEP_THRESHOLD_CREDENTIAL_OFFSET + 1] = increments >> 8;
    return credentials;
  };

  it("returns the max effective balance of non-compounding credentials and ignores their bytes", () => {
    const credentials = compounding(64);
    credentials[0] = ETH1_ADDRESS_WITHDRAWAL_PREFIX;
    expect(getSweepThreshold(credentials)).toBe(MIN_ACTIVATION_BALANCE);
  });

  it("decodes the little-endian threshold in increments", () => {
    expect(getSweepThreshold(compounding(64))).toBe(64 * EFFECTIVE_BALANCE_INCREMENT);
    expect(getSweepThreshold(compounding(0x0102))).toBe(0x0102 * EFFECTIVE_BALANCE_INCREMENT);
  });

  it("reads zero and out-of-range values as the default", () => {
    expect(getSweepThreshold(compounding(0))).toBe(MAX_EFFECTIVE_BALANCE_ELECTRA);
    expect(getSweepThreshold(compounding(31))).toBe(MAX_EFFECTIVE_BALANCE_ELECTRA);
    expect(getSweepThreshold(compounding(2049))).toBe(MAX_EFFECTIVE_BALANCE_ELECTRA);
    expect(getSweepThreshold(compounding(0xffff))).toBe(MAX_EFFECTIVE_BALANCE_ELECTRA);
  });

  it("accepts the range boundaries", () => {
    expect(getSweepThreshold(compounding(32))).toBe(MIN_ACTIVATION_BALANCE);
    expect(getSweepThreshold(compounding(2048))).toBe(MAX_EFFECTIVE_BALANCE_ELECTRA);
  });

  it("encodes a threshold without touching the other bytes and stores the maximum as zero", () => {
    const original = compounding(0);
    original.fill(7, 3, 32);
    const custom = withSweepThreshold(original, 1000 * EFFECTIVE_BALANCE_INCREMENT);
    expect(
      Array.from(custom.subarray(SWEEP_THRESHOLD_CREDENTIAL_OFFSET, SWEEP_THRESHOLD_CREDENTIAL_OFFSET + 2))
    ).toEqual([0xe8, 0x03]);
    expect(custom[0]).toBe(original[0]);
    expect(custom.subarray(3)).toEqual(original.subarray(3));
    expect(getSweepThreshold(custom)).toBe(1000 * EFFECTIVE_BALANCE_INCREMENT);
    expect(withSweepThreshold(custom, MAX_EFFECTIVE_BALANCE_ELECTRA)).toEqual(original);
    expect(getSweepThresholdIncrements(original)).toBe(0);
    expect(getSweepThresholdIncrements(custom)).toBe(1000);
  });
});

describe("isPartiallyWithdrawableValidator post-heze", () => {
  const threshold = 64 * EFFECTIVE_BALANCE_INCREMENT;
  const credentials = new Uint8Array(32);
  credentials[0] = COMPOUNDING_WITHDRAWAL_PREFIX;
  const validator = generateValidator({activation: 0, exit: Infinity});
  validator.withdrawalCredentials = withSweepThreshold(credentials, threshold);
  validator.effectiveBalance = threshold;

  it("uses the custom threshold instead of the compounding maximum", () => {
    expect(isPartiallyWithdrawableValidator(ForkSeq.heze, validator, threshold + 1)).toBe(true);
    expect(isPartiallyWithdrawableValidator(ForkSeq.heze, validator, threshold)).toBe(false);
    expect(isPartiallyWithdrawableValidator(ForkSeq.gloas, validator, threshold + 1)).toBe(false);
  });

  it("falls back to the compounding maximum when the bytes are zero", () => {
    const defaultValidator = {...validator, withdrawalCredentials: credentials};
    expect(isPartiallyWithdrawableValidator(ForkSeq.heze, defaultValidator, threshold + 1)).toBe(false);
  });

  it("allows an effective balance above the threshold", () => {
    const above = {...validator, effectiveBalance: MAX_EFFECTIVE_BALANCE_ELECTRA};
    expect(isPartiallyWithdrawableValidator(ForkSeq.heze, above, MAX_EFFECTIVE_BALANCE_ELECTRA)).toBe(true);
  });
});
