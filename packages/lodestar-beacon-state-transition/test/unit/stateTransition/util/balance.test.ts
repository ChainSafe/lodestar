import {assert} from "chai";

import {BeaconState, Gwei, Validator, ValidatorIndex} from "@chainsafe/lodestar-types";

import {
  increaseBalance,
  decreaseBalance,
  getTotalBalance,
} from "../../../../src/util";

import {generateValidators} from "../../../utils/validator";
import {generateState} from "../../../utils/state";


describe("getTotalBalance", () => {

  it("should return correct balances", () => {
    const num = 5;
    const validators: Validator[] = generateValidators(num).map((v) => {
      v.effectiveBalance = 500n;
      return v;
    });
    const state: BeaconState = generateState({validators: validators});
    const validatorIndices: ValidatorIndex[] = Array.from({length: num}, (_, i) => i);

    const result = getTotalBalance(state, validatorIndices);
    const expected = BigInt(num) * 500n;
    assert(result === expected, `Expected: ${expected} :: Result: ${result}`);
  });

  it("should return correct balances", () => {
    const num = 5;
    const validators: Validator[] = generateValidators(num);
    const balances: Gwei[] = Array.from({length: num}, () => 0n);
    const state: BeaconState = generateState({validators: validators, balances});
    const validatorIndices: ValidatorIndex[] = Array.from({length: num}, (_, i) => i);

    const result = getTotalBalance(state, validatorIndices);
    const expected = 1n;
    assert(result === expected, `Expected: ${expected} :: Result: ${result}`);
  });
});

describe("increaseBalance", () => {
  it("should add to a validators balance", () => {
    const state = generateState();
    state.validators = generateValidators(1);
    state.balances = [0n];
    const delta = 5n;
    for (let i = 1n; i < 10n; i++) {
      increaseBalance(state, 0, delta);
      assert(state.balances[0] === delta * i );
    }
  });
});

describe("decreaseBalance", () => {
  it("should subtract from a validators balance", () => {
    const state = generateState();
    state.validators = generateValidators(1);
    const initial = 100n
    state.balances = [initial];
    const delta = 5n
    for (let i = 1n; i < 10n; i++) {
      decreaseBalance(state, 0, delta);
      assert(state.balances[0] === (initial - (delta * i)));
    }
  });
  it("should not make a validators balance < 0", () => {
    const state = generateState();
    state.validators = generateValidators(1);
    const initial = 10n;
    state.balances = [initial];
    const delta = 11n
    decreaseBalance(state, 0, delta);
    assert(state.balances[0] === 0n);
  });
});
