import {assert, expect} from "chai";

import {phase0, ssz} from "@chainsafe/lodestar-types";

import {getActiveValidatorIndices, isActiveValidator, isSlashableValidator} from "../../../src/util/index.js";

import {randBetween} from "../../utils/misc.js";
import {generateValidator} from "../../utils/validator.js";
import {generateState} from "../../utils/state.js";

describe("getActiveValidatorIndices", () => {
  it("empty list of validators should return no indices (empty list)", () => {
    assert.deepEqual(getActiveValidatorIndices(generateState(), randBetween(0, 4)), []);
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
    assert.deepEqual(getActiveValidatorIndices(state, activationEpoch), allActiveIndices);
    assert.deepEqual(getActiveValidatorIndices(state, exitEpoch), allInactiveIndices);
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
      expect(result).to.be.equal(testValue.expected);
    });
  }
});

describe("isSlashableValidator", () => {
  let validator: phase0.Validator;

  beforeEach(function () {
    validator = generateValidator();
  });

  it("should check validator.slashed", () => {
    validator.activationEpoch = 0;
    validator.withdrawableEpoch = Infinity;
    validator.slashed = false;
    assert(isSlashableValidator(validator, 0), "unslashed validator should be slashable");
    validator.slashed = true;
    assert(!isSlashableValidator(validator, 0), "slashed validator should not be slashable");
  });
  it("should check validator.activationEpoch", () => {
    validator.activationEpoch = 10;
    validator.withdrawableEpoch = Infinity;
    assert(
      !isSlashableValidator(validator, validator.activationEpoch - 1),
      "unactivated validator should not be slashable"
    );
    assert(isSlashableValidator(validator, validator.activationEpoch), "activated validator should be slashable");
  });
  it("should check validator.withdrawableEpoch", () => {
    validator.activationEpoch = 0;
    validator.withdrawableEpoch = 10;
    assert(
      isSlashableValidator(validator, validator.withdrawableEpoch - 1),
      "nonwithdrawable validator should be slashable"
    );
    assert(
      !isSlashableValidator(validator, validator.withdrawableEpoch),
      "withdrawable validator should not be slashable"
    );
  });
});
