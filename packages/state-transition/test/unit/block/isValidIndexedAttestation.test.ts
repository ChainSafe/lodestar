import {expect} from "chai";
import {config} from "@lodestar/config/default";
import {FAR_FUTURE_EPOCH, MAX_EFFECTIVE_BALANCE} from "@lodestar/params";
import {phase0, ssz} from "@lodestar/types";
import {EMPTY_SIGNATURE} from "../../../src/index.js";
import {generateCachedState} from "../../utils/state.js";
import {generateValidators} from "../../utils/validator.js";
import {isValidIndexedAttestation} from "../../../src/block/isValidIndexedAttestation.js";

describe("validate indexed attestation", () => {
  const state = generateCachedState(config, {
    validators: generateValidators(100, {
      balance: MAX_EFFECTIVE_BALANCE,
      activation: 0,
      withdrawableEpoch: FAR_FUTURE_EPOCH,
      exit: FAR_FUTURE_EPOCH,
    }),
  });

  const testValues = [
    {
      indices: [] as number[],
      expectedValue: false,
      name: "should return invalid indexed attestation - empty participants",
    },
    {
      indices: [1, 0],
      expectedValue: false,
      name: "should return invalid indexed attestation - indexes not sorted",
    },
    {
      indices: [0, 1, 2, 3],
      expectedValue: true,
      name: "should return valid indexed attestation",
    },
  ];

  for (const testValue of testValues) {
    it(testValue.name, function () {
      const attestationData = ssz.phase0.AttestationData.defaultValue();
      attestationData.source.epoch = 0;
      attestationData.target.epoch = 1;

      const indexedAttestation: phase0.IndexedAttestation = {
        attestingIndices: testValue.indices,
        data: attestationData,
        signature: EMPTY_SIGNATURE,
      };
      expect(isValidIndexedAttestation(state, indexedAttestation, false)).to.be.equal(testValue.expectedValue);
    });
  }
});
