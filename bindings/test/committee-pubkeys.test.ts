import {afterEach, beforeAll, describe, expect, it} from "vitest";
import {BLS_VERIFIER_SET_TYPE, type BlsSignatureSet, verifySignatureSets} from "../src/bls-verifier.js";
import {SecretKey, aggregateSignatures} from "../src/blst.js";
import {
  COMMITTEE_PUBKEYS_MAX_ENTRIES,
  committeePubkeysCount,
  computeCommitteePubkeys,
  releaseCommitteePubkeys,
} from "../src/committee-pubkeys.js";
import {pubkeyCache} from "../src/pubkeys.js";

// The addon is built for the mainnet preset
const SLOTS_PER_EPOCH = 32;
const COMMITTEES_PER_SLOT = 2;
const MEMBERS_PER_COMMITTEE = 8;
const VALIDATOR_COUNT = SLOTS_PER_EPOCH * COMMITTEES_PER_SLOT * MEMBERS_PER_COMMITTEE;

const keys = Array.from({length: VALIDATOR_COUNT}, (_, i) => {
  const ikm = new Uint8Array(32);
  new DataView(ikm.buffer).setUint32(0, i + 1);
  return SecretKey.fromKeygen(ikm);
});
// Any permutation works; reversing keeps committee members away from their index order
const shuffling = Uint32Array.from({length: VALIDATOR_COUNT}, (_, i) => VALIDATOR_COUNT - 1 - i);
const message = new Uint8Array(32).fill(7);

function committee(slot: number, committeeIndex: number): Uint32Array {
  const count = SLOTS_PER_EPOCH * COMMITTEES_PER_SLOT;
  const index = slot * COMMITTEES_PER_SLOT + committeeIndex;
  return shuffling.subarray(
    Math.floor((VALIDATOR_COUNT * index) / count),
    Math.floor((VALIDATOR_COUNT * (index + 1)) / count)
  );
}

/** Builds a valid set where member `i` of the concatenated committees participates if `participates(i)` */
function committeeSet(
  committeePubkeysId: number,
  slot: number,
  committeeIndices: number[],
  participates: (bit: number) => boolean
): BlsSignatureSet & {type: typeof BLS_VERIFIER_SET_TYPE.committee} {
  const members = committeeIndices.flatMap((committeeIndex) => Array.from(committee(slot, committeeIndex)));
  const aggregationBits = new Uint8Array(Math.ceil(members.length / 8));
  const indices: number[] = [];
  for (const [bit, member] of members.entries()) {
    if (participates(bit)) {
      aggregationBits[bit >> 3] |= 1 << (bit & 7);
      indices.push(member);
    }
  }
  return {
    aggregationBits,
    bitLen: members.length,
    committeeIndices: Uint32Array.from(committeeIndices),
    committeePubkeysId,
    indices: Uint32Array.from(indices),
    message,
    signature: aggregateSignatures(indices.map((index) => keys[index].sign(message))).toBytes(),
    slot: 5 * SLOTS_PER_EPOCH + slot,
    type: BLS_VERIFIER_SET_TYPE.committee,
  };
}

describe("committee pubkeys", () => {
  const ids: number[] = [];

  beforeAll(() => {
    pubkeyCache.reset();
    for (const [index, key] of keys.entries()) {
      pubkeyCache.append(index, key.toPublicKey().toBytes());
    }
  });

  afterEach(() => {
    for (const id of ids.splice(0)) releaseCommitteePubkeys(id);
  });

  async function compute(): Promise<number> {
    const id = await computeCommitteePubkeys(shuffling, COMMITTEES_PER_SLOT);
    ids.push(id);
    return id;
  }

  it("verifies attestations by subtracting absent members or adding participants", async () => {
    const id = await compute();
    expect(committeePubkeysCount()).toBe(1);

    const sets = [
      committeeSet(id, 0, [0], () => true),
      committeeSet(id, 3, [1], (bit) => bit !== 2),
      committeeSet(id, 7, [0, 1], (bit) => bit % 5 !== 0),
      committeeSet(id, 31, [0, 1], (bit) => bit === 4 || bit === 11),
    ];
    expect(verifySignatureSets(sets)).toBe(true);

    const wrongMessage = {...sets[1], message: new Uint8Array(32).fill(8)};
    expect(verifySignatureSets([sets[0], wrongMessage])).toBe(false);
  });

  it("falls back to the participant indices when the entry is not cached", async () => {
    const id = await compute();
    const set = committeeSet(id, 9, [0, 1], (bit) => bit !== 6);
    expect(releaseCommitteePubkeys(id)).toBe(true);
    expect(releaseCommitteePubkeys(id)).toBe(false);

    expect(verifySignatureSets([set])).toBe(true);
    expect(verifySignatureSets([{...set, committeePubkeysId: 0}])).toBe(true);
  });

  it("throws when the participant indices disagree with the aggregation bits", async () => {
    const id = await compute();
    const set = committeeSet(id, 2, [0], () => true);
    expect(() => verifySignatureSets([{...set, indices: set.indices.subarray(1)}])).toThrow(
      "CommitteeParticipantsMismatch"
    );
  });

  it("does not detect same-count participant indices from another committee", async () => {
    const id = await compute();
    const set = committeeSet(id, 5, [0], () => true);
    const swapped = {...set, indices: committee(5, 1)};
    // Cached path only compares participant counts
    expect(verifySignatureSets([swapped])).toBe(true);
    expect(releaseCommitteePubkeys(id)).toBe(true);
    // Fallback aggregates the supplied indices, so the signature no longer matches
    expect(verifySignatureSets([swapped])).toBe(false);
  });

  it("uses a fresh id after release and falls back for the stale id", async () => {
    const oldId = await compute();
    const set = committeeSet(oldId, 6, [0], (bit) => bit % 2 === 0);
    expect(releaseCommitteePubkeys(oldId)).toBe(true);

    const newId = await compute();
    expect(newId).not.toBe(oldId);
    expect(verifySignatureSets([set])).toBe(true);
  });

  it("throws for aggregation bits that do not cover the committees", async () => {
    const id = await compute();
    const set = committeeSet(id, 2, [0, 1], () => true);
    expect(() => verifySignatureSets([{...set, bitLen: set.bitLen - 1}])).toThrow("InvalidBitLength");
    expect(() => verifySignatureSets([{...set, committeeIndices: Uint32Array.from([1, 0])}])).toThrow(
      "UnsortedCommitteeIndices"
    );
    expect(() => verifySignatureSets([{...set, committeeIndices: Uint32Array.from([0, 2])}])).toThrow(
      "InvalidCommitteeIndex"
    );
  });

  it("drops every entry when the pubkey cache is reset", async () => {
    const id = await compute();
    const set = committeeSet(id, 4, [0], () => true);
    pubkeyCache.reset();
    expect(committeePubkeysCount()).toBe(0);
    expect(releaseCommitteePubkeys(id)).toBe(false);

    for (const [index, key] of keys.entries()) {
      pubkeyCache.append(index, key.toPublicKey().toBytes());
    }
    expect(verifySignatureSets([set])).toBe(true);
  });

  it("rejects an invalid committee count and bounds the number of entries", async () => {
    expect(COMMITTEE_PUBKEYS_MAX_ENTRIES).toBe(16);
    await expect(computeCommitteePubkeys(shuffling, 0)).rejects.toThrow("InvalidCommitteesPerSlot");
    const recoveredId = await compute();
    expect(committeePubkeysCount()).toBe(1);
    expect(releaseCommitteePubkeys(recoveredId)).toBe(true);

    // Computations in flight count too
    const pending = Array.from({length: COMMITTEE_PUBKEYS_MAX_ENTRIES}, () => compute());
    expect(() => computeCommitteePubkeys(shuffling, COMMITTEES_PER_SLOT)).toThrow("TooManyCommitteePubkeys");
    await Promise.all(pending);
    expect(committeePubkeysCount()).toBe(COMMITTEE_PUBKEYS_MAX_ENTRIES);
  });
});
