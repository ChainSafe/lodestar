import {describe, expect, it} from "vitest";
import {ContainerType} from "@chainsafe/ssz";
import {ssz} from "../../../src/index.js";
import {ValidatorType} from "../../../src/phase0/validator.js";

const ValidatorContainer = new ContainerType(ValidatorType, {typeName: "Validator", jsonCase: "eth2"});

describe("Validator ssz types", () => {
  it("should serialize to the same value", () => {
    const seedValidator = {
      activationEligibilityEpoch: 10,
      activationEpoch: 11,
      exitEpoch: Infinity,
      slashed: false,
      withdrawableEpoch: 13,
      pubkey: Buffer.alloc(48, 100),
      withdrawalCredentials: Buffer.alloc(32, 100),
    };

    const validators = [
      {...seedValidator, effectiveBalance: 31000000000, slashed: false},
      {...seedValidator, effectiveBalance: 32000000000, slashed: true},
    ];

    for (const validator of validators) {
      const serialized = ValidatorContainer.serialize(validator);
      const serialized2 = ssz.phase0.Validator.serialize(validator);
      expect(serialized).toEqual(serialized2);
    }
  });
});

describe("Eth1Data ssz type", () => {
  it("preserves depositCount values above Number.MAX_SAFE_INTEGER", () => {
    const bytes = ssz.phase0.Eth1Data.serialize(ssz.phase0.Eth1Data.defaultValue());
    bytes.set([0x01, 0, 0, 0, 0, 0, 0x20, 0], 32);

    const eth1Data = ssz.phase0.Eth1Data.deserialize(bytes);

    expect(eth1Data.depositCount).toBe(9007199254740993n);
    expect(ssz.phase0.Eth1Data.serialize(eth1Data)).toEqual(bytes);
  });
});
