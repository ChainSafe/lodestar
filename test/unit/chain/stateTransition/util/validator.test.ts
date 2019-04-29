import { assert } from "chai";

import { Validator } from "../../../../../src/types";

import {
  getActiveValidatorIndices,
  isActiveValidator,
  isSlashableValidator,
} from "../../../../../src/chain/stateTransition/util/validator";

import { randBetween } from "../../../../utils/misc";
import { generateValidator } from "../../../../utils/validator";
import { generateState } from "../../../../utils/state";


describe("getActiveValidatorIndices", () => {
  const vrArray: Validator[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(generateValidator);

  it("empty list of Validators should return no indices (empty list)", () => {
    assert.deepEqual(getActiveValidatorIndices(generateState(), randBetween(0, 4)), []);
  });
});

describe("isActiveValidator", () => {
  it("should be active", () => {
    const v: Validator = generateValidator(0, 100);
    const result: boolean = isActiveValidator(v, 0);
    assert.isTrue(result);
  });

  it("should be active", () => {
    const v: Validator = generateValidator(10, 101);
    const result: boolean = isActiveValidator(v, 100);
    assert.isTrue(result);
  });

  it("should be active", () => {
    const v: Validator = generateValidator(100, 1000);
    const result: boolean = isActiveValidator(v, 100);
    assert.isTrue(result);
  });

  it("should not be active", () => {
    const v: Validator = generateValidator(1);
    const result: boolean = isActiveValidator(v, 0);
    assert.isFalse(result);
  });

  it("should not be active", () => {
    const v: Validator = generateValidator(100);
    const result: boolean = isActiveValidator(v, 5);
    assert.isFalse(result);
  });

  it("should not be active", () => {
    const v: Validator = generateValidator(1, 5);
    const result: boolean = isActiveValidator(v, 100);
    assert.isFalse(result);
  });
});
