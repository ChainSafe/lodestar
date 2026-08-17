import {beforeEach, describe, expect, it} from "vitest";
import {BitArray} from "@chainsafe/ssz";
import {BeaconConfig} from "@lodestar/config";
import {INCLUSION_LIST_COMMITTEE_SIZE} from "@lodestar/params";
import type {IBeaconStateViewHeze} from "@lodestar/state-transition";
import {ValidatorIndex, heze, ssz} from "@lodestar/types";
import {InclusionListInsertOutcome, InclusionListStore} from "../../../../src/chain/opPools/inclusionListStore.js";

describe("chain / opPools / InclusionListStore", () => {
  const slot = 100;
  // Distinct validator indices, one per committee position
  const committee = Uint32Array.from(Array.from({length: INCLUSION_LIST_COMMITTEE_SIZE}, (_, i) => i + 1));
  const committeeRoot = ssz.heze.InclusionListCommittee.hashTreeRoot(Array.from(committee));

  const state = {
    getInclusionListCommittee: () => committee,
  } as unknown as IBeaconStateViewHeze;

  const config = {MIN_SLOTS_FOR_INCLUSION_LISTS_REQUESTS: 1} as BeaconConfig;

  const makeInclusionList = (
    validatorIndex: ValidatorIndex,
    transactions: Uint8Array[],
    opts?: {slot?: number; committeeRoot?: Uint8Array}
  ): heze.SignedInclusionList => ({
    message: {
      slot: opts?.slot ?? slot,
      validatorIndex,
      inclusionListCommitteeRoot: opts?.committeeRoot ?? committeeRoot,
      transactions,
    },
    signature: Buffer.alloc(96, 0),
  });

  const txA = Uint8Array.from([1, 2, 3]);
  const txB = Uint8Array.from([4, 5]);

  let store: InclusionListStore;
  beforeEach(() => {
    store = new InclusionListStore(config);
  });

  it("stores a new inclusion list", () => {
    expect(store.process(makeInclusionList(1, [txA]), true)).toBe(InclusionListInsertOutcome.New);
    expect(store.size).toBe(1);
  });

  it("returns Seen for an identical re-submission without marking an equivocation", () => {
    store.process(makeInclusionList(1, [txA]), true);

    expect(store.process(makeInclusionList(1, [txA]), true)).toBe(InclusionListInsertOutcome.Seen);
    expect(store.size).toBe(1);
    expect(store.getInclusionListTransactions(state, slot)).toHaveLength(1);
  });

  it("marks an equivocation on a conflicting inclusion list and stops counting the validator", () => {
    store.process(makeInclusionList(1, [txA]), true);
    store.process(makeInclusionList(2, [txB]), true);

    expect(store.process(makeInclusionList(1, [txB]), true)).toBe(InclusionListInsertOutcome.Equivocating);
    // The conflicting list is not stored, and the already-stored one stops counting
    expect(store.getInclusionListTransactions(state, slot)).toEqual([txB]);
    expect(store.getInclusionListBits(state, slot).getTrueBitIndexes()).toEqual([1]);

    expect(store.process(makeInclusionList(1, [txA]), true)).toBe(InclusionListInsertOutcome.SubsequentEquivocation);
  });

  it("deduplicates transactions across inclusion lists", () => {
    store.process(makeInclusionList(1, [txA, txB]), true);
    store.process(makeInclusionList(2, [txA]), true);

    expect(store.getInclusionListTransactions(state, slot)).toEqual([txA, txB]);
  });

  it("excludes untimely inclusion lists unless onlyTimely is false", () => {
    store.process(makeInclusionList(1, [txA]), true);
    store.process(makeInclusionList(2, [txB]), false);

    expect(store.getInclusionListTransactions(state, slot)).toEqual([txA]);
    expect(store.getInclusionListBits(state, slot).getTrueBitIndexes()).toEqual([0]);

    expect(store.getInclusionListTransactions(state, slot, false)).toEqual([txA, txB]);
    expect(store.getInclusionListBits(state, slot, false).getTrueBitIndexes()).toEqual([0, 1]);
  });

  it("ignores inclusion lists stored under a different committee root", () => {
    const otherRoot = Buffer.alloc(32, 0xff);
    store.process(makeInclusionList(1, [txA], {committeeRoot: otherRoot}), true);

    expect(store.size).toBe(1);
    expect(store.getInclusionListTransactions(state, slot)).toEqual([]);
  });

  describe("isInclusionListBitsInclusive", () => {
    beforeEach(() => {
      store.process(makeInclusionList(1, [txA]), true);
      store.process(makeInclusionList(3, [txB]), true);
    });

    it("accepts bits that cover the local view", () => {
      const bits = BitArray.fromBoolArray(
        Array.from({length: INCLUSION_LIST_COMMITTEE_SIZE}, (_, i) => i === 0 || i === 2 || i === 5)
      );
      expect(store.isInclusionListBitsInclusive(state, slot, bits)).toBe(true);
    });

    it("rejects bits missing a locally observed inclusion list", () => {
      const bits = BitArray.fromBoolArray(Array.from({length: INCLUSION_LIST_COMMITTEE_SIZE}, (_, i) => i === 0));
      expect(store.isInclusionListBitsInclusive(state, slot, bits)).toBe(false);
    });
  });

  describe("getByIndices", () => {
    it("returns only the requested committee positions", () => {
      const first = makeInclusionList(1, [txA]);
      const third = makeInclusionList(3, [txB]);
      store.process(first, true);
      store.process(third, true);

      const indices = BitArray.fromBoolArray(Array.from({length: INCLUSION_LIST_COMMITTEE_SIZE}, (_, i) => i === 2));
      expect(store.getByIndices(state, slot, committeeRootHex(), indices)).toEqual([third]);
    });

    it("serves untimely inclusion lists but never equivocators", () => {
      const untimely = makeInclusionList(1, [txA]);
      store.process(untimely, false);
      store.process(makeInclusionList(3, [txA]), true);
      store.process(makeInclusionList(3, [txB]), true);

      const indices = BitArray.fromBoolArray(
        Array.from({length: INCLUSION_LIST_COMMITTEE_SIZE}, (_, i) => i === 0 || i === 2)
      );
      expect(store.getByIndices(state, slot, committeeRootHex(), indices)).toEqual([untimely]);
    });
  });

  describe("prune", () => {
    it("retains MIN_SLOTS_FOR_INCLUSION_LISTS_REQUESTS slots beyond the inclusion list slot", () => {
      store.process(makeInclusionList(1, [txA]), true);

      store.prune(slot + 1);
      expect(store.size).toBe(1);

      store.prune(slot + 2);
      expect(store.size).toBe(0);
    });

    it("rejects inclusion lists below the prune horizon", () => {
      store.prune(slot + 2);

      expect(store.process(makeInclusionList(1, [txA]), true)).toBe(InclusionListInsertOutcome.Old);
    });
  });

  describe("seenTwice", () => {
    it("tracks the p2p first-or-second message rule per validator and slot", () => {
      expect(store.seenTwice(slot, 1)).toBe(false);

      store.process(makeInclusionList(1, [txA]), true);
      expect(store.seenTwice(slot, 1)).toBe(false);

      store.process(makeInclusionList(1, [txB]), true);
      expect(store.seenTwice(slot, 1)).toBe(true);
      expect(store.seenTwice(slot, 2)).toBe(false);
    });
  });

  function committeeRootHex(): string {
    return `0x${Buffer.from(committeeRoot).toString("hex")}`;
  }
});
