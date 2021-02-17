import {List} from "@chainsafe/ssz";
import {config} from "@chainsafe/lodestar-config/mainnet";
import {generateAttestationData} from "../../../utils/attestation";
import {expect} from "chai";
import {IndexedAttestation} from "@chainsafe/lodestar-types";
import {EMPTY_SIGNATURE, phase0} from "../../../../src";
import {generateState} from "../../../utils/state";
import {generateValidators} from "../../../utils/validator";

describe("validate indexed attestation", () => {
  const epochCtx = new phase0.fast.EpochContext(config);
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
    expect(phase0.fast.isValidIndexedAttestation(epochCtx, state, indexedAttestation, false)).to.be.false;
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
    expect(phase0.fast.isValidIndexedAttestation(epochCtx, state, indexedAttestation, false)).to.be.false;
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

    expect(phase0.fast.isValidIndexedAttestation(epochCtx, state, indexedAttestation, false)).to.be.true;
  });
});
