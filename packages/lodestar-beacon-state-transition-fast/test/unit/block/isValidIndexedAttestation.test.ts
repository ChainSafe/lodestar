import {List} from "@chainsafe/ssz";
import {config} from "@chainsafe/lodestar-config/mainnet";
import {expect} from "chai";
import {IndexedAttestation} from "@chainsafe/lodestar-types";
import {generateAttestationData} from "@chainsafe/lodestar-beacon-state-transition/test/utils/attestation";
import {EMPTY_SIGNATURE} from "@chainsafe/lodestar-beacon-state-transition";
import {generateState} from "@chainsafe/lodestar-beacon-state-transition/test/utils/state";
import {generateValidators} from "@chainsafe/lodestar-beacon-state-transition/test/utils/validator";
import {EpochContext} from "../../../src";
import {isValidIndexedAttestation} from "../../../src/block/isValidIndexedAttestation";

describe("validate indexed attestation", () => {
  const epochCtx = new EpochContext(config);
  it("should return invalid indexed attestation - empty participants", () => {
    const attestationData = generateAttestationData(0, 1);
    const state = generateState({
      validators: generateValidators(100),
    });

    const indexedAttestation: IndexedAttestation = {
      attestingIndices: ([] as number[]) as List<number>,
      data: attestationData,
      signature: EMPTY_SIGNATURE,
    };
    expect(isValidIndexedAttestation(epochCtx, state, indexedAttestation, false)).to.be.false;
  });

  it("should return invalid indexed attestation - indexes not sorted", () => {
    const attestationData = generateAttestationData(0, 1);
    const state = generateState({
      validators: generateValidators(100),
    });

    const indexedAttestation: IndexedAttestation = {
      attestingIndices: [1, 0] as List<number>,
      data: attestationData,
      signature: EMPTY_SIGNATURE,
    };
    expect(isValidIndexedAttestation(epochCtx, state, indexedAttestation, false)).to.be.false;
  });

  it("should return valid indexed attestation", () => {
    const attestationData = generateAttestationData(0, 1);
    const state = generateState({
      validators: generateValidators(100),
    });

    const indexedAttestation: IndexedAttestation = {
      attestingIndices: [0, 1, 2, 3] as List<number>,
      data: attestationData,
      signature: EMPTY_SIGNATURE,
    };

    expect(isValidIndexedAttestation(epochCtx, state, indexedAttestation, false)).to.be.true;
  });
});
