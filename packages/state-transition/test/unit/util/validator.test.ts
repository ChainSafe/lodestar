import {describe, it, expect, beforeEach} from "vitest";

import {phase0, ssz} from "@lodestar/types";

import {getActiveValidatorIndices, isActiveValidator, isSlashableValidator} from "../../../src/util/index.js";

import {randBetween} from "../../utils/misc.js";
import {generateValidator} from "../../utils/validator.js";
import {generateState} from "../../utils/state.js";

describe("getActiveValidatorIndices", () => {
  it("empty list of validators should return no indices (empty list)", () => {
    expect(getActiveValidatorIndices(generateState(), randBetween(0, 4))).toStrictEqual([]);
  });
  it("list of cloned validators should return all or none", () => {
    const state = generateState();
    const activationEpoch = 1;
    const exitEpoch = 10;
    state.validators = ssz.phase0.Validators.toViewDU(
      Array.from({length: 10}, () => generateValidator({activation: activationEpoch, exit: exitEpoch}))
    );

    const allActiveIndices = state.validators.getAllReadonlyValues().map((_, i) => i);
    const allInactiveIndices: any = [];
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
