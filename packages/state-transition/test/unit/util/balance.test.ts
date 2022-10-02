import {assert, expect} from "chai";
import {config as minimalConfig} from "@lodestar/config/default";

import {EFFECTIVE_BALANCE_INCREMENT} from "@lodestar/params";
import {ValidatorIndex} from "@lodestar/types";

import {increaseBalance, decreaseBalance, getTotalBalance, isActiveValidator} from "../../../src/util/index.js";
import {getEffectiveBalanceIncrementsZeroed, getEffectiveBalanceIncrementsZeroInactive} from "../../../src/index.js";

import {generateValidators} from "../../utils/validator.js";
import {generateCachedState, generateState} from "../../utils/state.js";

describe("getTotalBalance", () => {
  it("should return correct balances - 500 validators", () => {
    const num = 500;
    const validatorBalance = 1e12;
    const validators = generateValidators(num);
    for (const v of validators) {
      v.effectiveBalance = validatorBalance;
    }
    const state = generateState({validators: validators});
    const validatorIndices: ValidatorIndex[] = Array.from({length: num}, (_, i) => i);

    const result = getTotalBalance(state, validatorIndices);
    const expected = BigInt(num * validatorBalance);
    assert(result === expected, `Expected: ${expected} :: Result: ${result}`);
  });

  it("should return correct balances - 5 validators", () => {
    const num = 5;
    const validators = generateValidators(num);
    const balances = Array.from({length: num}, () => 0);
    const state = generateState({validators: validators, balances});
    const validatorIndices: ValidatorIndex[] = Array.from({length: num}, (_, i) => i);

    const result = getTotalBalance(state, validatorIndices);
    const expected = EFFECTIVE_BALANCE_INCREMENT;
    assert(result === BigInt(expected), `Expected: ${expected} :: Result: ${result}`);
  });
});

describe("increaseBalance", () => {
  it("should add to a validators balance", () => {
    const state = generateCachedState();
    state.balances.push(0);
    expect(state.balances.get(0)).to.be.equal(0);

    const delta = 5;
    for (let i = 1; i < 10; i++) {
      increaseBalance(state, 0, delta);
      expect(state.balances.get(0)).to.be.equal(delta * i);
    }
  });
});

describe("decreaseBalance", () => {
  it("should subtract from a validators balance", () => {
    const state = generateCachedState();
    const initial = 100;
    state.balances.push(initial);

    const delta = 5;
    for (let i = 1; i < 10; i++) {
      decreaseBalance(state, 0, delta);
      expect(state.balances.get(0)).to.be.equal(initial - delta * i);
    }
  });

  it("should not make a validators balance < 0", () => {
    const state = generateCachedState();
    const initial = 10;
    state.balances.push(initial);
    const delta = 11;
    decreaseBalance(state, 0, delta);
    expect(state.balances.get(0)).to.be.equal(0);
  });
});

describe("getEffectiveBalanceIncrementsZeroInactive", () => {
  it("should get correct effective balances", () => {
    const justifiedState = generateCachedState(minimalConfig, {
      validators: [
        // not active
        ...generateValidators(3, {activation: Infinity, exit: Infinity, balance: 32e9}),
        // active
        ...generateValidators(4, {activation: 0, exit: Infinity, balance: 32e9}),
        // not active
        ...generateValidators(5, {activation: Infinity, exit: Infinity, balance: 32e9}),
      ],
    });
    const justifiedEpoch = justifiedState.epochCtx.currentShuffling.epoch;
    const validators = justifiedState.validators.getAllReadonlyValues();
    const effectiveBalances = getEffectiveBalanceIncrementsZeroed(validators.length);

    for (let i = 0, len = validators.length; i < len; i++) {
      const validator = validators[i];
      effectiveBalances[i] = isActiveValidator(validator, justifiedEpoch)
        ? Math.floor(validator.effectiveBalance / EFFECTIVE_BALANCE_INCREMENT)
        : 0;
    }

    expect(getEffectiveBalanceIncrementsZeroInactive(justifiedState)).to.be.deep.equal(
      effectiveBalances,
      "wrong effectiveBalances"
    );
  });
});
