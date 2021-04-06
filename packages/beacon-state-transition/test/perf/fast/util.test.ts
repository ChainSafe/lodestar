import {config} from "@chainsafe/lodestar-config/mainnet";
import {interopSecretKeys} from "../../../src/util";
import {expect} from "chai";
import {createFlat, createValidatorFlat} from "../../../src/fast";

describe("createFlat", function () {
  this.timeout(0);

  it.only("Array[createFlat] vs Array[createValidatorFlat", () => {
    const numValidators = 114038;
    const numKeyPairs = 100;
    const secretKeys = interopSecretKeys(numKeyPairs);
    const validators = Array.from({length: numValidators}, (_, i) => {
      return config.types.phase0.Validator.createTreeBackedFromStruct ({
        pubkey: secretKeys[i % numKeyPairs].toPublicKey().toBytes(),
        withdrawalCredentials: Buffer.alloc(32, i),
        effectiveBalance: BigInt(31000000000),
        slashed: false,
        activationEligibilityEpoch: 0,
        activationEpoch: 0,
        exitEpoch: Infinity,
        withdrawableEpoch: Infinity,
      });
    });
    const flatValidators = validators.map((v) => createFlat(v));
    const flatValidators2 = validators.map((v) => createValidatorFlat(v));
    // the result from createFlat and createValidatorFlat are the same
    expect(flatValidators).to.be.deep.equal(flatValidators2);
    let start = Date.now();
    for (let i = 0; i < 16; i++) {
      flatValidators.map((v) => v.exitEpoch);
    }
    console.log("@@@ map using createFlat in ", Date.now() - start);
    start = Date.now();
    // this simulate 16 validator exits in a block
    // using regular array instead of persistent-ts to isolate the issue
    for (let i = 0; i < 16; i++) {
      flatValidators2.map((v) => v.exitEpoch);
    }
    console.log("@@@ map using createValidatorFlat in ", Date.now() - start);

  });

});
