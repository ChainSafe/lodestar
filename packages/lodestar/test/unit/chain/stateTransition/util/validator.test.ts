import {assert} from "chai";

import {Validator} from "@chainsafe/eth2.0-types";

import {
  getActiveValidatorIndices,
  isActiveValidator,
  isSlashableValidator,
} from "../../../../../src/chain/stateTransition/util";

import {randBetween} from "../../../../utils/misc";
import {generateValidator} from "../../../../utils/validator";
import {generateState} from "../../../../utils/state";
import {FAR_FUTURE_EPOCH} from "../../../../../src/constants";


describe("getActiveValidatorIndices", () => {
  it("empty list of validators should return no indices (empty list)", () => {
    assert.deepEqual(getActiveValidatorIndices(generateState(), randBetween(0, 4)), []);
  });
  it("list of cloned validators should return all or none", () => {
    const state = generateState();
    const activationEpoch = 1;
    const exitEpoch = 10;
    state.validators = Array.from({length: 10},
      () => generateValidator({activation: activationEpoch, exit: exitEpoch }));
    const allActiveIndices = state.validators.map((_, i) => i);
    const allInactiveIndices = [];
    assert.deepEqual(getActiveValidatorIndices(state, activationEpoch), allActiveIndices);
    assert.deepEqual(getActiveValidatorIndices(state, exitEpoch), allInactiveIndices);
  });
});

describe("isActiveValidator", () => {
  it("should be active", () => {
    const v: Validator = generateValidator({activation: 0, exit: 100});
    const result: boolean = isActiveValidator(v, 0);
    assert.isTrue(result);
  });

  it("should be active", () => {
    const v: Validator = generateValidator({activation: 10, exit: 101});
    const result: boolean = isActiveValidator(v, 100);
    assert.isTrue(result);
  });

  it("should be active", () => {
    const v: Validator = generateValidator({activation: 100, exit: 1000 });
    const result: boolean = isActiveValidator(v, 100);
    assert.isTrue(result);
  });

  it("should not be active", () => {
    const v: Validator = generateValidator({activation: 1});
    const result: boolean = isActiveValidator(v, 0);
    assert.isFalse(result);
  });

  it("should not be active", () => {
    const v: Validator = generateValidator({activation: 100 });
    const result: boolean = isActiveValidator(v, 5);
    assert.isFalse(result);
  });

  it("should not be active", () => {
    const v: Validator = generateValidator({activation: 1, exit: 5 });
    const result: boolean = isActiveValidator(v, 100);
    assert.isFalse(result);
  });
});

describe("isSlashableValidator", () => {
  it("should check validator.slashed", () => {
    const validator = generateValidator();
    validator.activationEpoch = 0;
    validator.withdrawableEpoch = Infinity;
    validator.slashed = false;
    assert(isSlashableValidator(validator, 0),
      "unslashed validator should be slashable");
    validator.slashed = true;
    assert(!isSlashableValidator(validator, 0),
      "slashed validator should not be slashable");
  });
  it("should check validator.activationEpoch", () => {
    const validator = generateValidator();
    validator.activationEpoch = 10;
    validator.withdrawableEpoch = Infinity;
    assert(!isSlashableValidator(validator, validator.activationEpoch - 1),
      "unactivated validator should not be slashable");
    assert(isSlashableValidator(validator, validator.activationEpoch),
      "activated validator should be slashable");
  });
  it("should check validator.withdrawableEpoch", () => {
    const validator = generateValidator();
    validator.activationEpoch = 0;
    validator.withdrawableEpoch = 10;
    assert(isSlashableValidator(validator, validator.withdrawableEpoch - 1),
      "nonwithdrawable validator should be slashable");
    assert(!isSlashableValidator(validator, validator.withdrawableEpoch),
      "withdrawable validator should not be slashable");
  });
});
