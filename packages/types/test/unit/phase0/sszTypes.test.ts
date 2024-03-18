import {ContainerType} from "@chainsafe/ssz";
import {describe, it, expect} from "vitest";
import {ssz} from "../../../src/index.js";
import {ValidatorType} from "../../../src/phase0/validator.js";

const ValidatorContainer = new ContainerType(ValidatorType, {typeName: "Validator", jsonCase: "eth2"});

describe("Validator ssz types", function () {
  it("should serialize to the same value", () => {
    const validator = ValidatorContainer.defaultValue();
    validator.activationEligibilityEpoch = 10;
    validator.activationEpoch = 11;
    validator.exitEpoch = Infinity;
    validator.slashed = false;
    validator.effectiveBalance = 31000000000;
    validator.withdrawableEpoch = 13;
    validator.pubkey = Buffer.alloc(48, 100);
    validator.withdrawalCredentials = Buffer.alloc(32, 100);

    const serialized = ValidatorContainer.serialize(validator);
    const serialized2 = ssz.phase0.Validator.serialize(validator);
    expect(serialized).toEqual(serialized2);
  });
});
