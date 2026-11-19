import {describe, expect, it} from "vitest";
import {ForkSeq} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {getAttesterSlashingsFromIndexedAttestations} from "../../../../../src/api/impl/lodestar/attesterSlashing.js";

describe("api - lodestar - attesterSlashing", () => {
  describe("getAttesterSlashingsFromIndexedAttestations", () => {
    it("empty input - empty output", () => {
      expect(getAttesterSlashingsFromIndexedAttestations(ForkSeq.phase0, [])).toStrictEqual([]);
    });
    it("double vote - slashing", () => {
      const attestation1 = ssz.phase0.IndexedAttestation.defaultValue();
      const attestation2 = ssz.phase0.IndexedAttestation.defaultValue();

      attestation2.data.beaconBlockRoot = new Uint8Array(32).fill(1);

      attestation1.attestingIndices.push(1);
      attestation2.attestingIndices.push(1);

      const result = getAttesterSlashingsFromIndexedAttestations(ForkSeq.phase0, [attestation1, attestation2]);
      expect(result).toHaveLength(1);
      expect(result[0].attestation1.data.beaconBlockRoot).toEqual(attestation1.data.beaconBlockRoot);
      expect(result[0].attestation2.data.beaconBlockRoot).toEqual(attestation2.data.beaconBlockRoot);
    });
    it("surrounding vote - first direction - slashing", () => {
      const attestation1 = ssz.phase0.IndexedAttestation.defaultValue();
      const attestation2 = ssz.phase0.IndexedAttestation.defaultValue();

      attestation1.attestingIndices.push(1);
      attestation2.attestingIndices.push(1);

      attestation1.data.source.epoch = 1;
      attestation1.data.target.epoch = 4;
      attestation2.data.source.epoch = 2;
      attestation2.data.target.epoch = 3;

      const result = getAttesterSlashingsFromIndexedAttestations(ForkSeq.phase0, [attestation1, attestation2]);
      expect(result).toHaveLength(1);
      expect(result[0].attestation1.data.beaconBlockRoot).toEqual(attestation1.data.beaconBlockRoot);
      expect(result[0].attestation2.data.beaconBlockRoot).toEqual(attestation2.data.beaconBlockRoot);
    });
    it("surrounding vote - second direction - slashing", () => {
      const attestation1 = ssz.phase0.IndexedAttestation.defaultValue();
      const attestation2 = ssz.phase0.IndexedAttestation.defaultValue();

      attestation1.attestingIndices.push(1);
      attestation2.attestingIndices.push(1);

      attestation1.data.source.epoch = 2;
      attestation1.data.target.epoch = 3;
      attestation2.data.source.epoch = 1;
      attestation2.data.target.epoch = 4;

      const result = getAttesterSlashingsFromIndexedAttestations(ForkSeq.phase0, [attestation1, attestation2]);
      expect(result).toHaveLength(1);
      expect(result[0].attestation1.data.beaconBlockRoot).toEqual(attestation2.data.beaconBlockRoot);
      expect(result[0].attestation2.data.beaconBlockRoot).toEqual(attestation1.data.beaconBlockRoot);
    });
    it("vote contradiction - different validators - no slashing", () => {
      const attestation1 = ssz.phase0.IndexedAttestation.defaultValue();
      const attestation2 = ssz.phase0.IndexedAttestation.defaultValue();

      attestation2.data.beaconBlockRoot = new Uint8Array(32).fill(1);

      attestation1.attestingIndices.push(1);
      attestation2.attestingIndices.push(2);

      expect(getAttesterSlashingsFromIndexedAttestations(ForkSeq.phase0, [attestation1, attestation2])).toStrictEqual(
        []
      );
    });
    it("agreeing votes - different validators - no slashing", () => {
      const attestation1 = ssz.phase0.IndexedAttestation.defaultValue();
      const attestation2 = ssz.phase0.IndexedAttestation.defaultValue();

      attestation1.attestingIndices.push(1);
      attestation2.attestingIndices.push(2);

      expect(getAttesterSlashingsFromIndexedAttestations(ForkSeq.phase0, [attestation1, attestation2])).toStrictEqual(
        []
      );
    });
  });
});
