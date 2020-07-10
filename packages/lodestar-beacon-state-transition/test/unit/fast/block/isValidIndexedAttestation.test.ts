import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {generateAttestationData} from "../../../utils/attestation";
import {expect} from "chai";
import {isValidIndexedAttestation} from "../../../../src/fast/block/isValidIndexedAttestation";
import {EpochContext} from "../../../../src/fast";
import {IndexedAttestation} from "@chainsafe/lodestar-types";
import {EMPTY_SIGNATURE} from "../../../../src";
import { generateState } from "../../../utils/state";
import { generateValidator } from "../../../utils/validator";

describe("validate indexed attestation", () => {
  const epochCtx = new EpochContext(config);
  it("should return invalid indexed attestation - empty participants", () => {
    const attestationData = generateAttestationData(0, 1);
    const state = generateState({
      validators: Array.from({length: 100}, () => generateValidator())
    });

    const indexedAttestation: IndexedAttestation = {
      attestingIndices: [],
      data: attestationData,
      signature: EMPTY_SIGNATURE,
    };
    expect(isValidIndexedAttestation(epochCtx, state, indexedAttestation, false)).to.be.false;
  });

  it("should return invalid indexed attestation - indexes not sorted", () => {
    const attestationData = generateAttestationData(0, 1);
    const state = generateState({
      validators: Array.from({length: 100}, () => generateValidator())
    });

    const indexedAttestation: IndexedAttestation = {
      attestingIndices: [1, 0],
      data: attestationData,
      signature: EMPTY_SIGNATURE,
    };
    expect(isValidIndexedAttestation(epochCtx, state, indexedAttestation, false)).to.be.false;
  });

  it("should return valid indexed attestation", () => {
    const attestationData = generateAttestationData(0, 1);
    const state = generateState({
      validators: Array.from({length: 100}, () => generateValidator())
    });

    const indexedAttestation: IndexedAttestation = {
      attestingIndices: [0, 1, 2, 3],
      data: attestationData,
      signature: EMPTY_SIGNATURE,
    };

    expect(isValidIndexedAttestation(epochCtx, state, indexedAttestation, false)).to.be.true;
  });


});
