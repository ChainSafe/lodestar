import {assert} from "chai";

import {List} from "@chainsafe/ssz";
import {BeaconState, Gwei, ValidatorIndex} from "@chainsafe/lodestar-types";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";

import {
  increaseBalance,
  decreaseBalance,
  getTotalBalance,
} from "../../../../src/util";

import {generateValidators} from "../../../utils/validator";
import {generateState} from "../../../utils/state";


describe("getTotalBalance", () => {

  it("should return correct balances", () => {
    const num = 500;
    const validatorBalance = 1000000000000n;
    const validators = generateValidators(num);
    for (const v of validators) {
      v.effectiveBalance = validatorBalance;
    }
    const state: BeaconState = generateState({validators: validators});
    const validatorIndices: ValidatorIndex[] = Array.from({length: num}, (_, i) => i);

    const result = getTotalBalance(config, state, validatorIndices);
    const expected = BigInt(num) * validatorBalance;
    assert(result === expected, `Expected: ${expected} :: Result: ${result}`);
  });

  it("should return correct balances", () => {
    const num = 5;
    const validators = generateValidators(num);
    const balances = Array.from({length: num}, () => 0n) as List<Gwei>;
    const state: BeaconState = generateState({validators: validators, balances});
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
    state.balances = [0n] as List<Gwei>;
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
    state.balances = [initial] as List<Gwei>;
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
    state.balances = [initial] as List<Gwei>;
    const delta = 11n
    decreaseBalance(state, 0, delta);
    assert(state.balances[0] === 0n);
  });
});
