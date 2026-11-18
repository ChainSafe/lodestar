import {describe, expect, it} from "vitest";
import {config} from "@lodestar/config/default";
import {Db} from "@lodestar/db";
import {ssz} from "@lodestar/types";
import {AttesterSlashingRepository, ProposerSlashingRepository} from "../../../../../src/db/repositories/index.js";

describe("slashing repositories", () => {
  const db = {} as Db;

  it("stores a proposer slashing with BLS or leanXMSS signatures", () => {
    const repository = new ProposerSlashingRepository(config, db);
    for (const type of [ssz.phase0.ProposerSlashing, ssz.pq.ProposerSlashing]) {
      const slashing = type.defaultValue();
      slashing.signedHeader1.signature.fill(7);
      expect(repository.decodeValue(repository.encodeValue(slashing))).toEqual(slashing);
    }
  });

  it("stores an attester slashing with signatures or proofs", () => {
    const repository = new AttesterSlashingRepository(config, db);
    const electra = ssz.electra.AttesterSlashing.defaultValue();
    electra.attestation1.attestingIndices = [1, 2];
    expect(repository.decodeValue(repository.encodeValue(electra))).toEqual(electra);

    const pq = ssz.pq.AttesterSlashing.defaultValue();
    pq.attestation1.attestingIndices = [1, 2];
    pq.attestation1.proof = new Uint8Array([1, 2, 3]);
    expect(repository.decodeValue(repository.encodeValue(pq))).toEqual(pq);
  });
});
