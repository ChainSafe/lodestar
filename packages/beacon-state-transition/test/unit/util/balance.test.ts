import {assert, expect} from "chai";
import {config as minimalConfig} from "@chainsafe/lodestar-config/default";

import {List, readonlyValuesListOfLeafNodeStruct} from "@chainsafe/ssz";
import {EFFECTIVE_BALANCE_INCREMENT} from "@chainsafe/lodestar-params";
import {phase0, ValidatorIndex} from "@chainsafe/lodestar-types";

import {increaseBalance, decreaseBalance, getTotalBalance, isActiveValidator} from "../../../src/util";

import {generateValidators} from "../../utils/validator";
import {generateCachedState, generateState} from "../../utils/state";
import {getEffectiveBalanceIncrementsZeroInactive, getEffectiveBalanceIncrementsZeroed} from "../../../src";

describe("getTotalBalance", () => {
  it("should return correct balances", () => {
    const num = 500;
    const validatorBalance = 1e12;
    const validators = generateValidators(num);
    for (const v of validators) {
      v.effectiveBalance = validatorBalance;
    }
    const state: phase0.BeaconState = generateState({validators: validators});
    const validatorIndices: ValidatorIndex[] = Array.from({length: num}, (_, i) => i);

    const result = getTotalBalance(state, validatorIndices);
    const expected = BigInt(num * validatorBalance);
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
    assert(result === BigInt(expected), `Expected: ${expected} :: Result: ${result}`);
  });
});

describe("increaseBalance", () => {
  it("should add to a validators balance", () => {
    const state = generateCachedState();

    state.validators.push(generateValidators(1)[0]);
    state.balanceList.push(0);
    expect(state.balanceList.get(0)).to.be.equal(0);
    expect(state.balances[0]).to.be.equal(0);
    const delta = 5;
    for (let i = 1; i < 10; i++) {
      increaseBalance(state, 0, delta);
      expect(state.balanceList.get(0)).to.be.equal(delta * i);
      expect(state.balances[0]).to.be.equal(delta * i);
    }
  });
});

describe("decreaseBalance", () => {
  it("should subtract from a validators balance", () => {
    const state = generateCachedState();
    state.validators.push(generateValidators(1)[0]);
    const initial = 100;
    state.balanceList.push(initial);
    const delta = 5;
    for (let i = 1; i < 10; i++) {
      decreaseBalance(state, 0, delta);
      expect(state.balanceList.get(0)).to.be.equal(initial - delta * i);
      expect(state.balances[0]).to.be.equal(initial - delta * i);
    }
  });
  it("should not make a validators balance < 0", () => {
    const state = generateCachedState();
    state.validators.push(generateValidators(1)[0]);
    const initial = 10;
    state.balanceList.push(initial);
    const delta = 11;
    decreaseBalance(state, 0, delta);
    expect(state.balanceList.get(0)).to.be.equal(0);
    expect(state.balances[0]).to.be.equal(0);
  });
});

describe("getEffectiveBalances", () => {
  it("should get correct effective balances", () => {
    const justifiedState = generateCachedState(minimalConfig, {
      validators: [
        // not active
        ...generateValidators(3, {activation: Infinity, exit: Infinity, balance: 32e9}),
        // active
        ...generateValidators(4, {activation: 0, exit: Infinity, balance: 32e9}),
        // not active
        ...generateValidators(5, {activation: Infinity, exit: Infinity, balance: 32e9}),
      ] as List<phase0.Validator>,
    });
    const justifiedEpoch = justifiedState.currentShuffling.epoch;
    const validators = readonlyValuesListOfLeafNodeStruct(justifiedState.validators);
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
