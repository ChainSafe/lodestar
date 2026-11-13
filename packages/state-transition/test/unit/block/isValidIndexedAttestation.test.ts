import {describe, expect, it} from "vitest";
import {config} from "@lodestar/config/default";
import {aggregateSignatures} from "@lodestar/native/blst";
import {pubkeyCache} from "@lodestar/native/pubkeys";
import {FAR_FUTURE_EPOCH, MAX_EFFECTIVE_BALANCE} from "@lodestar/params";
import {IndexedAttestation, ssz} from "@lodestar/types";
import {isValidIndexedAttestation} from "../../../src/block/isValidIndexedAttestation.js";
import {assertValidAttesterSlashing} from "../../../src/block/processAttesterSlashing.js";
import {EMPTY_SIGNATURE} from "../../../src/index.js";
import {
  getAttesterSlashingSignatureSets,
  getIndexedAttestationBigintSignatureSet,
} from "../../../src/signatureSets/attesterSlashings.js";
import {generateCachedState} from "../../../src/testUtils/state.js";
import {interopSecretKey} from "../../../src/util/interop.js";
import {verifySignatureSet} from "../../../src/util/signatureSets.js";
import {generateValidators} from "../../utils/validator.js";

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
      indices: [0, 0],
      expectedValue: false,
      name: "should return invalid indexed attestation - duplicate indexes",
    },
    {
      indices: [0, 1, 2, 3],
      expectedValue: true,
      name: "should return valid indexed attestation",
    },
    {
      indices: [0],
      expectedValue: true,
      name: "should return valid indexed attestation - single index 0",
    },
  ];

  it.each(testValues)("$name", ({indices, expectedValue}) => {
    const attestationData = ssz.phase0.AttestationData.defaultValue();
    attestationData.source.epoch = 0;
    attestationData.target.epoch = 1;

    const indexedAttestation: IndexedAttestation = {
      attestingIndices: indices,
      data: attestationData,
      signature: EMPTY_SIGNATURE,
    };
    expect(isValidIndexedAttestation(state.config, state.slot, state, indexedAttestation, false)).toBe(expectedValue);
  });

  it("resolves inactive attester-slashing participants from the requesting registry", () => {
    pubkeyCache.reset();
    const keys = [interopSecretKey(0), interopSecretKey(1), interopSecretKey(2)];
    const registry = ssz.phase0.BeaconState.defaultViewDU();
    for (const [index, key] of keys.slice(0, 2).entries()) {
      registry.validators.push(
        ssz.phase0.Validator.toViewDU({
          ...ssz.phase0.Validator.defaultValue(),
          pubkey: key.toPublicKey().toBytes(),
          activationEpoch: index === 0 ? 0 : FAR_FUTURE_EPOCH,
          exitEpoch: FAR_FUTURE_EPOCH,
        })
      );
    }
    pubkeyCache.append(0, keys[0].toPublicKey().toBytes());
    pubkeyCache.addCandidate(1, keys[1].toPublicKey().toBytes());
    pubkeyCache.addCandidate(1, keys[2].toPublicKey().toBytes());
    const slashing = ssz.phase0.AttesterSlashing.defaultValue();
    slashing.attestation2.data.beaconBlockRoot = Buffer.alloc(32, 1);
    for (const attestation of [slashing.attestation1, slashing.attestation2]) {
      attestation.attestingIndices = [0, 1];
      const set = getIndexedAttestationBigintSignatureSet(state.config, registry.slot, attestation);
      attestation.signature = aggregateSignatures(keys.slice(0, 2).map((key) => key.sign(set.signingRoot))).toBytes();
    }

    expect(() => assertValidAttesterSlashing(state.config, registry.slot, registry, slashing)).not.toThrow();
    const view = {validatorCount: 2, getValidator: (index: number) => registry.validators.getReadonly(index)};
    for (const set of getAttesterSlashingSignatureSets(state.config, registry.slot, view, slashing)) {
      expect(verifySignatureSet(set), "attester slashing signature").toBe(true);
    }
    expect(pubkeyCache.size).toBe(1);

    registry.validators.get(1).pubkey = keys[2].toPublicKey().toBytes();
    expect(() => assertValidAttesterSlashing(state.config, registry.slot, registry, slashing)).toThrow(
      "AttesterSlashing attestation0 is invalid"
    );
  });
});
