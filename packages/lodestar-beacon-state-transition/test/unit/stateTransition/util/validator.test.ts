import {assert} from "chai";

import {Validator} from "@chainsafe/lodestar-types";

import {
  getActiveValidatorIndices,
  isActiveValidator,
  isSlashableValidator,
} from "../../../../src/util";

import {randBetween} from "../../../utils/misc";
import {generateValidator} from "../../../utils/validator";
import {generateState} from "../../../utils/state";
import {FAR_FUTURE_EPOCH} from "../../../src/constants";


describe("getActiveValidatorIndices", () => {
  it("empty list of validators should return no indices (empty list)", () => {
    assert.deepEqual(getActiveValidatorIndices(generateState(), BigInt(randBetween(0, 4))), []);
  });
  it("list of cloned validators should return all or none", () => {
    const state = generateState();
    const activationEpoch = 1n;
    const exitEpoch = 10n;
    state.validators = Array.from({length: 10},
      () => generateValidator({activation: activationEpoch, exit: exitEpoch }));
    const allActiveIndices = Array.from(state.validators).map((_, i) => i);
    const allInactiveIndices: any = [];
    assert.deepEqual(getActiveValidatorIndices(state, activationEpoch), allActiveIndices);
    assert.deepEqual(getActiveValidatorIndices(state, exitEpoch), allInactiveIndices);
  });
});

describe("isActiveValidator", () => {
  it("should be active", () => {
    const v: Validator = generateValidator({activation: 0n, exit: 100n});
    const result: boolean = isActiveValidator(v, 0n);
    assert.isTrue(result);
  });

  it("should be active", () => {
    const v: Validator = generateValidator({activation: 10n, exit: 101n});
    const result: boolean = isActiveValidator(v, 100n);
    assert.isTrue(result);
  });

  it("should be active", () => {
    const v: Validator = generateValidator({activation: 100n, exit: 1000n });
    const result: boolean = isActiveValidator(v, 100n);
    assert.isTrue(result);
  });

  it("should not be active", () => {
    const v: Validator = generateValidator({activation: 1n});
    const result: boolean = isActiveValidator(v, 0n);
    assert.isFalse(result);
  });

  it("should not be active", () => {
    const v: Validator = generateValidator({activation: 100n });
    const result: boolean = isActiveValidator(v, 5n);
    assert.isFalse(result);
  });

  it("should not be active", () => {
    const v: Validator = generateValidator({activation: 1n, exit: 5n });
    const result: boolean = isActiveValidator(v, 100n);
    assert.isFalse(result);
  });
});

describe("isSlashableValidator", () => {
  it("should check validator.slashed", () => {
    const validator = generateValidator();
    validator.activationEpoch = 0n;
    validator.withdrawableEpoch = FAR_FUTURE_EPOCH;
    validator.slashed = false;
    assert(isSlashableValidator(validator, 0n),
      "unslashed validator should be slashable");
    validator.slashed = true;
    assert(!isSlashableValidator(validator, 0n),
      "slashed validator should not be slashable");
  });
  it("should check validator.activationEpoch", () => {
    const validator = generateValidator();
    validator.activationEpoch = 10n;
    validator.withdrawableEpoch = FAR_FUTURE_EPOCH;
    assert(!isSlashableValidator(validator, validator.activationEpoch - 1n),
      "unactivated validator should not be slashable");
    assert(isSlashableValidator(validator, validator.activationEpoch),
      "activated validator should be slashable");
  });
  it("should check validator.withdrawableEpoch", () => {
    const validator = generateValidator();
    validator.activationEpoch = 0n;
    validator.withdrawableEpoch = 10n;
    assert(isSlashableValidator(validator, validator.withdrawableEpoch - 1n),
      "nonwithdrawable validator should be slashable");
    assert(!isSlashableValidator(validator, validator.withdrawableEpoch),
      "withdrawable validator should not be slashable");
  });
});
