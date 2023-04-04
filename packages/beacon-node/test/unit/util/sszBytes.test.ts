import {expect} from "chai";
import {Epoch, phase0, RootHex, Slot, ssz} from "@lodestar/types";
import {fromHex, toHex} from "@lodestar/utils";
import {
  getAttDataHashFromAttestationSerialized,
  getAttDataHashFromSignedAggregateAndProofSerialized,
  getBlockRootFromAttestationSerialized,
  getBlockRootFromSignedAggregateAndProofSerialized,
  getSlotFromAttestationSerialized,
  getSlotFromSignedAggregateAndProofSerialized,
} from "../../../src/util/sszBytes.js";

describe("attestation SSZ serialized peaking", () => {
  const testCases: phase0.Attestation[] = [
    ssz.phase0.Attestation.defaultValue(),
    attestationFromValues(
      4_000_000,
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaabbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      200_00,
      "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeffffffffffffffffffffffffffffffff"
    ),
  ];

  for (const [i, attestation] of testCases.entries()) {
    it(`attestation ${i}`, () => {
      const bytes = ssz.phase0.Attestation.serialize(attestation);

      expect(getSlotFromAttestationSerialized(bytes)).equals(attestation.data.slot);
      expect(getBlockRootFromAttestationSerialized(bytes)).equals(toHex(attestation.data.beaconBlockRoot));

      const attDataHash = ssz.phase0.AttestationData.serialize(attestation.data);
      expect(getAttDataHashFromAttestationSerialized(bytes)).to.be.equal(Buffer.from(attDataHash).toString("base64"));
    });
  }
});

describe("aggregateAndProof SSZ serialized peaking", () => {
  const testCases: phase0.SignedAggregateAndProof[] = [
    ssz.phase0.SignedAggregateAndProof.defaultValue(),
    signedAggregateAndProofFromValues(
      4_000_000,
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaabbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      200_00,
      "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeffffffffffffffffffffffffffffffff"
    ),
  ];

  for (const [i, signedAggregateAndProof] of testCases.entries()) {
    it(`signedAggregateAndProof ${i}`, () => {
      const bytes = ssz.phase0.SignedAggregateAndProof.serialize(signedAggregateAndProof);

      expect(getSlotFromSignedAggregateAndProofSerialized(bytes)).equals(
        signedAggregateAndProof.message.aggregate.data.slot
      );
      expect(getBlockRootFromSignedAggregateAndProofSerialized(bytes)).equals(
        toHex(signedAggregateAndProof.message.aggregate.data.beaconBlockRoot)
      );

      const attDataHash = ssz.phase0.AttestationData.serialize(signedAggregateAndProof.message.aggregate.data);
      expect(getAttDataHashFromSignedAggregateAndProofSerialized(bytes)).to.be.equal(
        Buffer.from(attDataHash).toString("base64")
      );
    });
  }
});

function attestationFromValues(
  slot: Slot,
  blockRoot: RootHex,
  targetEpoch: Epoch,
  targetRoot: RootHex
): phase0.Attestation {
  const attestation = ssz.phase0.Attestation.defaultValue();
  attestation.data.slot = slot;
  attestation.data.beaconBlockRoot = fromHex(blockRoot);
  attestation.data.target.epoch = targetEpoch;
  attestation.data.target.root = fromHex(targetRoot);
  return attestation;
}

function signedAggregateAndProofFromValues(
  slot: Slot,
  blockRoot: RootHex,
  targetEpoch: Epoch,
  targetRoot: RootHex
): phase0.SignedAggregateAndProof {
  const signedAggregateAndProof = ssz.phase0.SignedAggregateAndProof.defaultValue();
  signedAggregateAndProof.message.aggregate.data.slot = slot;
  signedAggregateAndProof.message.aggregate.data.beaconBlockRoot = fromHex(blockRoot);
  signedAggregateAndProof.message.aggregate.data.target.epoch = targetEpoch;
  signedAggregateAndProof.message.aggregate.data.target.root = fromHex(targetRoot);
  return signedAggregateAndProof;
}
