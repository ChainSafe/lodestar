import {beforeAll, describe, expect, it} from "vitest";
import {XMSS_CLAIM_SIZE, XMSS_SIGNED_SIZE, XmssSecretKey} from "@lodestar/native/leanvm";
import {computeXmssAttestationLeafIndex} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {PqAttestationPool} from "../../../../src/chain/opPools/pqAttestationPool.js";
import {InsertOutcome} from "../../../../src/chain/opPools/types.js";
import {PqVerifier, canonicalClaims} from "../../../../src/chain/pq/verifier.js";

describe("PqAttestationPool", () => {
  const committeeSize = 4;
  const data = ssz.phase0.AttestationData.defaultValue();
  data.slot = 9;
  data.target.epoch = 1;
  const dataRootHex = "0x01";
  const signingRoot = new Uint8Array(32).fill(7);
  const verifier = new PqVerifier();

  const signed: Uint8Array[] = [];
  const claims: Uint8Array[] = [];

  beforeAll(async () => {
    for (let i = 0; i < committeeSize; i++) {
      const key = await XmssSecretKey.fromSeed(new Uint8Array(32).fill(i + 1));
      const claim = new Uint8Array(XMSS_CLAIM_SIZE);
      claim.set(key.toPublicKey(), 0);
      claim.set(signingRoot, 32);
      const signature = await key.sign(signingRoot, computeXmssAttestationLeafIndex(data.target.epoch));
      const signedClaim = new Uint8Array(XMSS_SIGNED_SIZE);
      signedClaim.set(claim, 0);
      signedClaim.set(signature, XMSS_CLAIM_SIZE);
      claims.push(claim);
      signed.push(signedClaim);
    }
  }, 60_000);

  it("proves a committee's single attestations for an aggregator", async () => {
    const pool = new PqAttestationPool();
    expect(await pool.getAggregate(data.slot, dataRootHex, 0)).toBeNull();

    for (const position of [0, 2, 3]) {
      expect(pool.addSingle(0, data, dataRootHex, position, committeeSize, signed[position])).toBe(
        InsertOutcome.NewData
      );
    }
    expect(pool.addSingle(0, data, dataRootHex, 2, committeeSize, signed[2])).toBe(InsertOutcome.AlreadyKnown);

    const proven = await pool.getAggregate(data.slot, dataRootHex, 0);
    if (proven === null) throw Error("no aggregate");
    expect(proven.aggregate.aggregationBits.toBoolArray()).toEqual([true, false, true, true]);

    const proof = proven.aggregate.aggregate.proof;
    const attested = Buffer.concat([claims[3], claims[0], claims[2], claims[0]]);
    expect(await verifier.verifyProofSets([{claims: attested, proof}])).toBe(true);
    // The proof covers exactly its attesters
    expect(await verifier.verifyProofSets([{claims: Buffer.concat(claims), proof}])).toBe(false);
    expect(await verifier.verifyProofSets([{claims: Buffer.concat([claims[0], claims[2]]), proof}])).toBe(false);
  }, 120_000);

  it("merges two committees into one block proof", async () => {
    const pool = new PqAttestationPool();
    // Committee 0 arrives as single attestations, committee 1 as a network aggregate
    pool.addSingle(0, data, dataRootHex, 0, 2, signed[0]);
    pool.addSingle(0, data, dataRootHex, 1, 2, signed[1]);

    const other = new PqAttestationPool();
    other.addSingle(1, data, dataRootHex, 0, 2, signed[2]);
    other.addSingle(1, data, dataRootHex, 1, 2, signed[3]);
    const networkAggregate = await other.getAggregate(data.slot, dataRootHex, 1);
    if (networkAggregate === null) throw Error("no aggregate");
    const {aggregationBits, aggregate} = networkAggregate.aggregate;
    expect(
      pool.addAggregate(1, data, dataRootHex, aggregationBits, aggregate.proof, Buffer.concat([claims[3], claims[2]]))
    ).toBe(InsertOutcome.Aggregated);

    const excluded = await pool.getAttestationsForBlock(data.slot + 1, () => false);
    expect(excluded).toEqual({attestations: [], proof: new Uint8Array(0)});

    const {attestations, proof} = await pool.getAttestationsForBlock(data.slot + 1, () => true);
    expect(attestations.length).toBe(1);
    expect(attestations[0].committeeBits.getTrueBitIndexes()).toEqual([0, 1]);
    expect(attestations[0].aggregationBits.toBoolArray()).toEqual([true, true, true, true]);
    expect(await verifier.verifyProofSets([{claims: Buffer.concat(claims), proof}])).toBe(true);
    expect(await verifier.verifyProofSets([{claims: Buffer.concat(claims.slice(1)), proof}])).toBe(false);
  }, 120_000);

  it("accepts an empty proof for no claims only", async () => {
    expect(await verifier.verifyProofSets([{claims: new Uint8Array(0), proof: new Uint8Array(0)}])).toBe(true);
    expect(await verifier.verifyProofSets([{claims: new Uint8Array(0), proof: new Uint8Array(1)}])).toBe(false);
    expect(await verifier.verifyProofSets([{claims: claims[0], proof: new Uint8Array(0)}])).toBe(false);
  });

  it("sorts and deduplicates claims", () => {
    const sorted = [...claims].sort(Buffer.compare);
    expect(
      Buffer.from(canonicalClaims(Buffer.concat([claims[2], claims[0], claims[3], claims[2], claims[1]])))
    ).toEqual(Buffer.concat(sorted));
  });
});
