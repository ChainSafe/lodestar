import {List} from "@chainsafe/ssz";
import {config} from "@chainsafe/lodestar-config/mainnet";
import {generateAttestationData} from "../../../utils/attestation";
import {expect} from "chai";
import {isValidIndexedAttestation} from "../../../../src/fast/block/isValidIndexedAttestation";
import {IndexedAttestation} from "@chainsafe/lodestar-types";
import {EMPTY_SIGNATURE} from "../../../../src";
import {generateState} from "../../../utils/state";
import {generateValidators} from "../../../utils/validator";
import {createCachedBeaconState} from "../../../../src/fast/util";
import {init} from "@chainsafe/bls";

describe("validate indexed attestation", () => {
  before(async () => {
    await init("blst-native");
  });

  it("should return invalid indexed attestation - empty participants", () => {
    const attestationData = generateAttestationData(0, 1);
    const cachedState = createCachedBeaconState(
      config,
      generateState({
        slot: 100,
        validators: generateValidators(10, {activation: 0, exit: 100000}),
      })
    );

    const indexedAttestation: IndexedAttestation = {
      attestingIndices: ([] as number[]) as List<number>,
      data: attestationData,
      signature: EMPTY_SIGNATURE,
    };
    expect(isValidIndexedAttestation(cachedState, indexedAttestation, false)).to.be.false;
  });

  it("should return invalid indexed attestation - indexes not sorted", () => {
    const attestationData = generateAttestationData(0, 1);
    const cachedState = createCachedBeaconState(
      config,
      generateState({
        validators: generateValidators(10, {activation: 0, exit: 100000}),
      })
    );

    const indexedAttestation: IndexedAttestation = {
      attestingIndices: [1, 0] as List<number>,
      data: attestationData,
      signature: EMPTY_SIGNATURE,
    };
    expect(isValidIndexedAttestation(cachedState, indexedAttestation, false)).to.be.false;
  });

  it("should return valid indexed attestation", () => {
    const attestationData = generateAttestationData(0, 1);
    const cachedState = createCachedBeaconState(
      config,
      generateState({
        validators: generateValidators(10, {activation: 0, exit: 100000}),
      })
    );

    const indexedAttestation: IndexedAttestation = {
      attestingIndices: [0, 1, 2, 3] as List<number>,
      data: attestationData,
      signature: EMPTY_SIGNATURE,
    };

    expect(isValidIndexedAttestation(cachedState, indexedAttestation, false)).to.be.true;
  });
});
