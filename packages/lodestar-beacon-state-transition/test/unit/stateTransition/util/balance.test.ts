import {assert} from "chai";

import {List} from "@chainsafe/ssz";
import {phase0, Gwei, ValidatorIndex} from "@chainsafe/lodestar-types";
import {config} from "@chainsafe/lodestar-config/minimal";

import {increaseBalance, decreaseBalance, getTotalBalance} from "../../../../src/util";

import {generateValidators} from "../../../utils/validator";
import {generateState} from "../../../utils/state";

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

    const result = getTotalBalance(config, state, validatorIndices);
    const expected = BigInt(num) * validatorBalance;
    assert(result === expected, `Expected: ${expected} :: Result: ${result}`);
  });

  it("should return correct balances", () => {
    const num = 5;
    const validators = generateValidators(num);
    const balances = Array.from({length: num}, () => BigInt(0)) as List<Gwei>;
    const state: phase0.BeaconState = generateState({validators: validators, balances});
    const validatorIndices: ValidatorIndex[] = Array.from({length: num}, (_, i) => i);

    const result = getTotalBalance(config, state, validatorIndices);
    const expected = config.params.EFFECTIVE_BALANCE_INCREMENT;
    assert(result === expected, `Expected: ${expected} :: Result: ${result}`);
  });
});

describe("increaseBalance", () => {
  it("should add to a validators balance", () => {
    const state = generateState();
    state.validators = generateValidators(1);
    state.balances = [BigInt(0)] as List<Gwei>;
    const delta = BigInt(5);
    for (let i = BigInt(1); i < BigInt(10); i++) {
      increaseBalance(state, 0, delta);
      assert(state.balances[0] === delta * i);
    }
  });
});

describe("decreaseBalance", () => {
  it("should subtract from a validators balance", () => {
    const state = generateState();
    state.validators = generateValidators(1);
    const initial = BigInt(100);
    state.balances = [initial] as List<Gwei>;
    const delta = BigInt(5);
    for (let i = BigInt(1); i < BigInt(10); i++) {
      decreaseBalance(state, 0, delta);
      assert(state.balances[0] === initial - delta * i);
    }
  });
  it("should not make a validators balance < 0", () => {
    const state = generateState();
    state.validators = generateValidators(1);
    const initial = BigInt(10);
    state.balances = [initial] as List<Gwei>;
    const delta = BigInt(11);
    decreaseBalance(state, 0, delta);
    assert(state.balances[0] === BigInt(0));
  });
});
