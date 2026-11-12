import {beforeEach, describe, expect, it} from "vitest";
import {ssz} from "@lodestar/types";
import {ValidatorRegistrationCache} from "../../../../src/execution/builder/cache.js";

describe("ValidatorRegistrationCache", () => {
  const gasLimit1 = 30000000;
  const gasLimit2 = 36000000;

  const validatorPubkey1 = new Uint8Array(48).fill(1);
  const validatorPubkey2 = new Uint8Array(48).fill(2);

  const validatorRegistration1 = ssz.bellatrix.ValidatorRegistrationV1.defaultValue();
  validatorRegistration1.pubkey = validatorPubkey1;
  validatorRegistration1.gasLimit = gasLimit1;

  const validatorRegistration2 = ssz.bellatrix.ValidatorRegistrationV1.defaultValue();
  validatorRegistration2.pubkey = validatorPubkey2;
  validatorRegistration2.gasLimit = gasLimit2;

  let cache: ValidatorRegistrationCache;

  beforeEach(() => {
    // max 2 items
    cache = new ValidatorRegistrationCache();
    cache.add(1, validatorRegistration1);
    cache.add(3, validatorRegistration2);
  });

  it("get for registered validator", () => {
    expect(cache.get(validatorPubkey1)?.gasLimit).toBe(gasLimit1);
  });

  it("get for unknown validator", () => {
    const unknownValidatorPubkey = new Uint8Array(48).fill(3);
    expect(cache.get(unknownValidatorPubkey)).toBe(undefined);
  });

  it("override and get latest", () => {
    const newGasLimit = 60000000;
    const registration = ssz.bellatrix.ValidatorRegistrationV1.defaultValue();
    registration.pubkey = validatorPubkey1;
    registration.gasLimit = newGasLimit;

    cache.add(5, registration);

    expect(cache.get(validatorPubkey1)?.gasLimit).toBe(newGasLimit);
  });

  it("prune", () => {
    cache.prune(4);

    // No registration as it has been pruned
    expect(cache.get(validatorPubkey1)).toBe(undefined);

    // Registration hasn't been pruned
    expect(cache.get(validatorPubkey2)?.gasLimit).toBe(gasLimit2);
  });
});
