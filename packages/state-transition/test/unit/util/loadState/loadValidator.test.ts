import {describe, it, expect} from "vitest";
import {CompositeViewDU} from "@chainsafe/ssz";
import {phase0, ssz} from "@lodestar/types";
import {loadValidator} from "../../../../src/util/loadState/loadValidator.js";

describe("loadValidator", () => {
  const validatorValue: phase0.Validator = {
    pubkey: Buffer.from(
      "0xb18e1737e1a1a76b8dff905ba7a4cb1ff5c526a4b7b0788188aade0488274c91e9c797e75f0f8452384ff53d44fad3df",
      "hex"
    ),
    withdrawalCredentials: Buffer.from("0x98d732925b0388ceb8b2b7efbe1163e4bc39082bb791940b2cda3837b0982c8d", "hex"),
    effectiveBalance: 32,
    slashed: false,
    activationEligibilityEpoch: 10,
    activationEpoch: 20,
    exitEpoch: 30,
    withdrawableEpoch: 40,
  };
  const validator = ssz.phase0.Validator.toViewDU(validatorValue);

  const testCases: {name: string; getValidator: () => CompositeViewDU<typeof ssz.phase0.Validator>}[] = [
    {
      name: "diff pubkey",
      getValidator: () => {
        const newValidator = validator.clone();
        newValidator.pubkey = Buffer.alloc(1, 48);
        return newValidator;
      },
    },
    {
      name: "diff withdrawal credentials",
      getValidator: () => {
        const newValidator = validator.clone();
        newValidator.withdrawalCredentials = Buffer.alloc(1, 32);
        return newValidator;
      },
    },
    {
      name: "diff effective balance",
      getValidator: () => {
        const newValidator = validator.clone();
        newValidator.effectiveBalance = 100;
        return newValidator;
      },
    },
    {
      name: "diff slashed",
      getValidator: () => {
        const newValidator = validator.clone();
        newValidator.slashed = true;
        return newValidator;
      },
    },
    {
      name: "diff activation eligibility epoch",
      getValidator: () => {
        const newValidator = validator.clone();
        newValidator.activationEligibilityEpoch = 100;
        return newValidator;
      },
    },
    {
      name: "diff activation epoch",
      getValidator: () => {
        const newValidator = validator.clone();
        newValidator.activationEpoch = 100;
        return newValidator;
      },
    },
    {
      name: "diff exit epoch",
      getValidator: () => {
        const newValidator = validator.clone();
        newValidator.exitEpoch = 100;
        return newValidator;
      },
    },
    {
      name: "diff withdrawable epoch",
      getValidator: () => {
        const newValidator = validator.clone();
        newValidator.withdrawableEpoch = 100;
        return newValidator;
      },
    },
    {
      name: "diff all",
      getValidator: () => {
        const newValidator = validator.clone();
        newValidator.pubkey = Buffer.alloc(1, 48);
        newValidator.withdrawalCredentials = Buffer.alloc(1, 32);
        newValidator.effectiveBalance = 100;
        newValidator.slashed = true;
        newValidator.activationEligibilityEpoch = 100;
        newValidator.activationEpoch = 100;
        newValidator.exitEpoch = 100;
        newValidator.withdrawableEpoch = 100;
        return newValidator;
      },
    },
    {
      name: "same validator",
      getValidator: () => validator.clone(),
    },
  ];

  it.each(testCases)("$name", ({getValidator}) => {
    const newValidator = getValidator();
    const newValidatorBytes = newValidator.serialize();
    const loadedValidator = loadValidator(validator, newValidatorBytes);
    expect(Buffer.compare(loadedValidator.hashTreeRoot(), newValidator.hashTreeRoot())).toBe(0);
    expect(Buffer.compare(loadedValidator.serialize(), newValidator.serialize())).toBe(0);
  });
});
