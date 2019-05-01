import BN from "bn.js";
import { assert } from "chai";

import { BeaconState, Gwei, Validator, ValidatorIndex } from "../../../../../src/types";

import {
  increaseBalance,
  decreaseBalance,
  getTotalBalance,
} from "../../../../../src/chain/stateTransition/util/balance";

import { generateValidators } from "../../../../utils/validator";
import { generateState } from "../../../../utils/state";


describe("getTotalBalance", () => {

  it("should return correct balances", () => {
    const num = 5;
    const validators: Validator[] = generateValidators(num).map((v) => {
      v.effectiveBalance = new BN(500);
      return v;
    });
    const state: BeaconState = generateState({ validatorRegistry: validators });
    const validatorIndices: ValidatorIndex[] = Array.from({ length: num }, (_, i) => i);

    const result = getTotalBalance(state, validatorIndices);
    const expected = new BN(num).muln(500);
    assert(result.eq(expected), `Expected: ${expected} :: Result: ${result}`);
  });

  it("should return correct balances", () => {
    const num = 5;
    const validators: Validator[] = generateValidators(num);
    const balances: Gwei[] = Array.from({ length: num }, () => new BN(0));
    const state: BeaconState = generateState({ validatorRegistry: validators, balances });
    const validatorIndices: ValidatorIndex[] = Array.from({ length: num }, (_, i) => i);

    const result = getTotalBalance(state, validatorIndices);
    const expected = new BN(num).muln(0);
    assert(result.eq(expected), `Expected: ${expected} :: Result: ${result}`);
  });
});
