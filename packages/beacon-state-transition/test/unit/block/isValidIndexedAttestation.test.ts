import {List, TreeBacked} from "@chainsafe/ssz";
import {config} from "@chainsafe/lodestar-config/default";
import {FAR_FUTURE_EPOCH, MAX_EFFECTIVE_BALANCE} from "@chainsafe/lodestar-params";
import {allForks, ssz} from "@chainsafe/lodestar-types";
import {generateAttestationData} from "../../utils/attestation";
import {expect} from "chai";
import {EMPTY_SIGNATURE} from "../../../src";
import {phase0, createCachedBeaconState} from "../../../src";
import {generateState} from "../../utils/state";
import {generateValidators} from "../../utils/validator";

describe("validate indexed attestation", () => {
  const treeState = ssz.phase0.BeaconState.createTreeBackedFromStruct(
    generateState({
      validators: generateValidators(100, {
        balance: MAX_EFFECTIVE_BALANCE,
        activation: 0,
        withdrawableEpoch: FAR_FUTURE_EPOCH,
        exit: FAR_FUTURE_EPOCH,
      }),
    })
  );

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
      const attestationData = generateAttestationData(0, 1);
      const state = createCachedBeaconState(config, treeState.clone() as TreeBacked<allForks.BeaconState>);

      const indexedAttestation: phase0.IndexedAttestation = {
        attestingIndices: testValue.indices as List<number>,
        data: attestationData,
        signature: EMPTY_SIGNATURE,
      };
      expect(phase0.isValidIndexedAttestation(state, indexedAttestation, false)).to.be.equal(testValue.expectedValue);
    });
  }
});
