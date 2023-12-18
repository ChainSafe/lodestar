import {describe, it, expect} from "vitest";
import {fromHexString} from "@chainsafe/ssz";
import {findModifiedValidators} from "../../../../src/util/loadState/findModifiedValidators.js";
import {generateState} from "../../../utils/state.js";
import {generateValidators} from "../../../utils/validator.js";

describe("findModifiedValidators", () => {
  const numValidator = 800_000;
  const expectedModifiedValidatorsArr: number[][] = [
    Array.from({length: 10_000}, (_, i) => 70 * i),
    Array.from({length: 1_000}, (_, i) => 700 * i),
    Array.from({length: 100}, (_, i) => 700 * i),
    Array.from({length: 10}, (_, i) => 700 * i),
    Array.from({length: 1}, (_, i) => 10 * i),
    [],
  ];

  const validators = generateValidators(numValidator);
  const state = generateState({validators: validators});
  const validatorsBytes = state.validators.serialize();

  for (const expectedModifiedValidators of expectedModifiedValidatorsArr) {
    const testCaseName =
      expectedModifiedValidators.length === 0
        ? "no difference"
        : expectedModifiedValidators.length + " modified validators";
    const modifiedPubkey = fromHexString(
      "0x98d732925b0388ceb8b2b7efbe1163e4bc39082bb791940b2cda3837b0982c8de8fad8ee7912abca4ab0ae7ad50d1b95"
    );
    it(testCaseName, () => {
      const clonedState = state.clone();
      for (const validatorIndex of expectedModifiedValidators) {
        clonedState.validators.get(validatorIndex).pubkey = modifiedPubkey;
      }
      const validatorsBytes2 = clonedState.validators.serialize();
      const modifiedValidators: number[] = [];
      findModifiedValidators(validatorsBytes, validatorsBytes2, modifiedValidators);
      expect(modifiedValidators.sort((a, b) => a - b)).toEqual(expectedModifiedValidators);
    });
  }
});
