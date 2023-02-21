import {expect} from "chai";
import {Epoch, phase0, RootHex, Slot, ssz} from "@lodestar/types";
import {fromHex} from "@lodestar/utils";
import {
  getBlockRootFromAttestationSerialized,
  getSlotFromAttestationSerialized,
  getTargetFromAttestationSerialized,
} from "../../../../src/util/sszBytes.js";

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
      const targetHex =
        toHexNoPrefix(ssz.UintNum64.serialize(attestation.data.target.epoch)) +
        toHexNoPrefix(attestation.data.target.root);

      expect(getSlotFromAttestationSerialized(bytes)).equals(attestation.data.slot);
      expect(getBlockRootFromAttestationSerialized(bytes)).equals(toHexNoPrefix(attestation.data.beaconBlockRoot));
      expect(getTargetFromAttestationSerialized(bytes)).equals(targetHex);
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

function toHexNoPrefix(data: Uint8Array): string {
  return Buffer.from(data).toString("hex");
}
