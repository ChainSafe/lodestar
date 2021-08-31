import {assert} from "chai";

import {List} from "@chainsafe/ssz";
import {EFFECTIVE_BALANCE_INCREMENT} from "@chainsafe/lodestar-params";
import {phase0, ValidatorIndex} from "@chainsafe/lodestar-types";

import {increaseBalance, decreaseBalance, getTotalBalance} from "../../../src/util";

import {generateValidators} from "../../utils/validator";
import {generateCachedState, generateState} from "../../utils/state";

describe("getTotalBalance", () => {
  it("should return correct balances", () => {
    const num = 500;
    const validatorBalance = BigInt(1000000000000);
    const validators = generateValidators(num);
    for (const v of validators) {
      v.effectiveBalance = validatorBalance;
    }
    const state: phase0.BeaconState = generateState({validators: validators});
    const validatorIndices: ValidatorIndex[] = Array.from({length: num}, (_, i) => i);

    const result = getTotalBalance(state, validatorIndices);
    const expected = BigInt(num) * validatorBalance;
    assert(result === expected, `Expected: ${expected} :: Result: ${result}`);
  });

  it("should return correct balances", () => {
    const num = 5;
    const validators = generateValidators(num);
    const balances = Array.from({length: num}, () => 0) as List<number>;
    const state: phase0.BeaconState = generateState({validators: validators, balances});
    const validatorIndices: ValidatorIndex[] = Array.from({length: num}, (_, i) => i);

    const result = getTotalBalance(state, validatorIndices);
    const expected = EFFECTIVE_BALANCE_INCREMENT;
    assert(result === expected, `Expected: ${expected} :: Result: ${result}`);
  });
});

describe("increaseBalance", () => {
  it("should add to a validators balance", () => {
    const state = generateCachedState();
    state.validators.push(generateValidators(1)[0]);
    state.balances.push(0);
    const delta = 5;
    for (let i = 1; i < 10; i++) {
      increaseBalance(state, 0, delta);
      assert(state.balances[0] === delta * i);
    }
  });
});

describe("decreaseBalance", () => {
  it("should subtract from a validators balance", () => {
    const state = generateCachedState();
    state.validators.push(generateValidators(1)[0]);
    const initial = 100;
    state.balances.push(initial);
    const delta = 5;
    for (let i = 1; i < 10; i++) {
      decreaseBalance(state, 0, delta);
      assert(state.balances[0] === initial - delta * i);
    }
  });
  it("should not make a validators balance < 0", () => {
    const state = generateCachedState();
    state.validators.push(generateValidators(1)[0]);
    const initial = 10;
    state.balances.push(initial);
    const delta = 11;
    decreaseBalance(state, 0, delta);
    assert(state.balances[0] === 0);
  });
});
