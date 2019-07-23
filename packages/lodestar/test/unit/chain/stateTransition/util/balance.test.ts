import BN from "bn.js";
import {assert} from "chai";

import {BeaconState, Gwei, Validator, ValidatorIndex} from "../../../../../src/types";

import {
  increaseBalance,
  decreaseBalance,
  getTotalBalance,
} from "../../../../../src/chain/stateTransition/util";

import {generateValidators} from "../../../../utils/validator";
import {generateState} from "../../../../utils/state";


describe("getTotalBalance", () => {

  it("should return correct balances", () => {
    const num = 5;
    const validators: Validator[] = generateValidators(num).map((v) => {
      v.effectiveBalance = new BN(500);
      return v;
    });
    const state: BeaconState = generateState({validators: validators});
    const validatorIndices: ValidatorIndex[] = Array.from({length: num}, (_, i) => i);

    const result = getTotalBalance(state, validatorIndices);
    const expected = new BN(num).muln(500);
    assert(result.eq(expected), `Expected: ${expected} :: Result: ${result}`);
  });

  it("should return correct balances", () => {
    const num = 5;
    const validators: Validator[] = generateValidators(num);
    const balances: Gwei[] = Array.from({length: num}, () => new BN(0));
    const state: BeaconState = generateState({validators: validators, balances});
    const validatorIndices: ValidatorIndex[] = Array.from({length: num}, (_, i) => i);

    const result = getTotalBalance(state, validatorIndices);
    const expected = new BN(1);
    assert(result.eq(expected), `Expected: ${expected} :: Result: ${result}`);
  });
});

describe("increaseBalance", () => {
  it("should add to a validators balance", () => {
    const state = generateState();
    state.validators = generateValidators(1);
    state.balances = [new BN(0)];
    const delta = new BN(5);
    for (let i = 1; i < 10; i++) {
      increaseBalance(state, 0, delta);
      assert(state.balances[0].eq(delta.muln(i)));
    }
  });
});

describe("decreaseBalance", () => {
  it("should subtract from a validators balance", () => {
    const state = generateState();
    state.validators = generateValidators(1);
    const initial = new BN(100);
    state.balances = [initial];
    const delta = new BN(5);
    for (let i = 1; i < 10; i++) {
      decreaseBalance(state, 0, delta);
      assert(state.balances[0].eq(initial.sub(delta.muln(i))));
    }
  });
  it("should not make a validators balance < 0", () => {
    const state = generateState();
    state.validators = generateValidators(1);
    const initial = new BN(10);
    state.balances = [initial];
    const delta = new BN(11);
    decreaseBalance(state, 0, delta);
    assert(state.balances[0].eqn(0));
  });
});
