import {describe, expect, it} from "vitest";
import {ForkSeq} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {
  getAttesterSlashingsFromIndexedAttestations,
  isSlashableAttestationPair,
} from "../../../../../src/api/impl/lodestar/attesterSlashing.js";

describe("api - lodestar - attesterSlashing", () => {
  describe("isSlashableAttestationPair", () => {
    it("non-slashable attestation pair", () => {
      const data1 = ssz.phase0.AttestationData.defaultValue();
      const data2 = ssz.phase0.AttestationData.defaultValue();

      data2.target.epoch = 1;

      expect(isSlashableAttestationPair(data1, data2)).toBe(false);
    });
    it("non-slashable attestation pair - identical data", () => {
      const data1 = ssz.phase0.AttestationData.defaultValue();
      const data2 = ssz.phase0.AttestationData.defaultValue();

      expect(isSlashableAttestationPair(data1, data2)).toBe(false);
    });
    it("slashable attestation pair - double vote", () => {
      const data1 = ssz.phase0.AttestationData.defaultValue();
      const data2 = ssz.phase0.AttestationData.defaultValue();

      data2.beaconBlockRoot = new Uint8Array(32).fill(1);

      expect(isSlashableAttestationPair(data1, data2)).toBe(true);
    });
    it("slashable attestation pair - surround vote - first direction", () => {
      const data1 = ssz.phase0.AttestationData.defaultValue();
      const data2 = ssz.phase0.AttestationData.defaultValue();

      data1.source.epoch = 1;
      data1.target.epoch = 4;
      data2.source.epoch = 2;
      data2.target.epoch = 3;

      expect(isSlashableAttestationPair(data1, data2)).toBe(true);
    });
    it("slashable attestation pair - surround vote - second direction", () => {
      const data1 = ssz.phase0.AttestationData.defaultValue();
      const data2 = ssz.phase0.AttestationData.defaultValue();

      data1.source.epoch = 2;
      data1.target.epoch = 3;
      data2.source.epoch = 1;
      data2.target.epoch = 4;

      expect(isSlashableAttestationPair(data1, data2)).toBe(true);
    });
  });

  describe("getAttesterSlashingsFromIndexedAttestations", () => {
    it("empty input - empty output", () => {
      expect(getAttesterSlashingsFromIndexedAttestations(ForkSeq.phase0, [])).toStrictEqual([]);
    });
    it("vote contradiction - same validator - slashing", () => {
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
