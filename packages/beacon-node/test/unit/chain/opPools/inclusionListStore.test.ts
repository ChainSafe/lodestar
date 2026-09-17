import {beforeEach, describe, expect, it} from "vitest";
import {BitArray} from "@chainsafe/ssz";
import {BeaconConfig} from "@lodestar/config";
import {INCLUSION_LIST_COMMITTEE_SIZE} from "@lodestar/params";
import {ValidatorIndex, heze} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {InclusionListInsertOutcome, InclusionListStore} from "../../../../src/chain/opPools/inclusionListStore.js";

describe("chain / opPools / InclusionListStore", () => {
  const slot = 100;
  const dependentRoot = Buffer.alloc(32, 0xaa);
  const dependentRootHex = toRootHex(dependentRoot);
  // Distinct validator indices, one per committee position: validator i + 1 sits at position i
  const committee = Uint32Array.from(Array.from({length: INCLUSION_LIST_COMMITTEE_SIZE}, (_, i) => i + 1));
  const committeeIndexOf = (validatorIndex: ValidatorIndex): number => committee.indexOf(validatorIndex);

  const config = {MIN_SLOTS_FOR_INCLUSION_LISTS_REQUESTS: 1} as BeaconConfig;

  const makeInclusionList = (
    validatorIndex: ValidatorIndex,
    transactions: Uint8Array[],
    opts?: {slot?: number; dependentRoot?: Uint8Array}
  ): heze.SignedInclusionList => ({
    message: {
      slot: opts?.slot ?? slot,
      validatorIndex,
      dependentRoot: opts?.dependentRoot ?? dependentRoot,
      transactions,
    },
    signature: Buffer.alloc(96, 0),
  });

  const txA = Uint8Array.from([1, 2, 3]);
  const txB = Uint8Array.from([4, 5]);

  let store: InclusionListStore;
  const process = (signedInclusionList: heze.SignedInclusionList, timely: boolean): InclusionListInsertOutcome =>
    store.process(signedInclusionList, committeeIndexOf(signedInclusionList.message.validatorIndex), timely);

  beforeEach(() => {
    store = new InclusionListStore(config);
  });

  it("stores a new inclusion list", () => {
    expect(process(makeInclusionList(1, [txA]), true)).toBe(InclusionListInsertOutcome.New);
    expect(store.size).toBe(1);
  });

  it("returns Seen for an identical re-submission without marking an equivocation", () => {
    process(makeInclusionList(1, [txA]), true);

    expect(process(makeInclusionList(1, [txA]), true)).toBe(InclusionListInsertOutcome.Seen);
    expect(store.size).toBe(1);
    expect(store.getInclusionListTransactions(slot, dependentRootHex)).toHaveLength(1);
  });

  it("marks an equivocation on a conflicting inclusion list and stops counting the validator", () => {
    process(makeInclusionList(1, [txA]), true);
    process(makeInclusionList(2, [txB]), true);

    expect(process(makeInclusionList(1, [txB]), true)).toBe(InclusionListInsertOutcome.Equivocating);
    // The first list stays stored but no longer counts
    expect(store.size).toBe(2);
    expect(store.getInclusionListTransactions(slot, dependentRootHex)).toEqual([txB]);
    expect(store.getInclusionListBits(slot, dependentRootHex).getTrueBitIndexes()).toEqual([1]);

    expect(process(makeInclusionList(1, [txB]), true)).toBe(InclusionListInsertOutcome.SubsequentEquivocation);
    // The stored list is already processed, resubmitting it is not new evidence
    expect(process(makeInclusionList(1, [txA]), true)).toBe(InclusionListInsertOutcome.Seen);
    expect(store.getInclusionListTransactions(slot, dependentRootHex)).toEqual([txB]);
  });

  it("deduplicates transactions across inclusion lists", () => {
    process(makeInclusionList(1, [txA, txB]), true);
    process(makeInclusionList(2, [txA]), true);

    expect(store.getInclusionListTransactions(slot, dependentRootHex)).toEqual([txA, txB]);
  });

  it("excludes untimely inclusion lists unless onlyTimely is false", () => {
    process(makeInclusionList(1, [txA]), true);
    process(makeInclusionList(2, [txB]), false);

    expect(store.getInclusionListTransactions(slot, dependentRootHex)).toEqual([txA]);
    expect(store.getInclusionListBits(slot, dependentRootHex).getTrueBitIndexes()).toEqual([0]);

    expect(store.getInclusionListTransactions(slot, dependentRootHex, false)).toEqual([txA, txB]);
    expect(store.getInclusionListBits(slot, dependentRootHex, false).getTrueBitIndexes()).toEqual([0, 1]);
  });

  it("keys inclusion lists by slot and dependent root", () => {
    const otherRoot = Buffer.alloc(32, 0xff);
    process(makeInclusionList(1, [txA], {dependentRoot: otherRoot}), true);
    process(makeInclusionList(2, [txB], {slot: slot + 1}), true);

    expect(store.size).toBe(2);
    expect(store.getInclusionListTransactions(slot, dependentRootHex)).toEqual([]);
    expect(store.getInclusionListTransactions(slot, toRootHex(otherRoot))).toEqual([txA]);
    expect(store.getInclusionListTransactions(slot + 1, dependentRootHex)).toEqual([txB]);
  });

  it("tracks equivocations per slot and dependent root", () => {
    const otherRoot = Buffer.alloc(32, 0xff);
    process(makeInclusionList(1, [txA]), true);
    process(makeInclusionList(1, [txB]), true);

    expect(process(makeInclusionList(1, [txA], {dependentRoot: otherRoot}), true)).toBe(InclusionListInsertOutcome.New);
    expect(store.getInclusionListTransactions(slot, dependentRootHex)).toEqual([]);
    expect(store.getInclusionListTransactions(slot, toRootHex(otherRoot))).toEqual([txA]);
  });

  describe("isInclusionListBitsInclusive", () => {
    beforeEach(() => {
      process(makeInclusionList(1, [txA]), true);
      process(makeInclusionList(3, [txB]), true);
    });

    it("accepts bits that cover the local view", () => {
      const bits = BitArray.fromBoolArray(
        Array.from({length: INCLUSION_LIST_COMMITTEE_SIZE}, (_, i) => i === 0 || i === 2 || i === 5)
      );
      expect(store.isInclusionListBitsInclusive(slot, dependentRootHex, bits)).toBe(true);
    });

    it("rejects bits missing a locally observed inclusion list", () => {
      const bits = BitArray.fromBoolArray(Array.from({length: INCLUSION_LIST_COMMITTEE_SIZE}, (_, i) => i === 0));
      expect(store.isInclusionListBitsInclusive(slot, dependentRootHex, bits)).toBe(false);
    });

    it("accepts any bits for an unknown dependent root", () => {
      const bits = BitArray.fromBitLen(INCLUSION_LIST_COMMITTEE_SIZE);
      expect(store.isInclusionListBitsInclusive(slot, toRootHex(Buffer.alloc(32, 0xff)), bits)).toBe(true);
    });
  });

  describe("getByIndices", () => {
    it("returns only the requested committee positions", () => {
      const first = makeInclusionList(1, [txA]);
      const third = makeInclusionList(3, [txB]);
      process(first, true);
      process(third, true);

      const indices = BitArray.fromBoolArray(Array.from({length: INCLUSION_LIST_COMMITTEE_SIZE}, (_, i) => i === 2));
      expect(store.getByIndices(slot, dependentRootHex, indices)).toEqual([third]);
    });

    it("serves untimely inclusion lists but never equivocators", () => {
      const untimely = makeInclusionList(1, [txA]);
      process(untimely, false);
      process(makeInclusionList(3, [txA]), true);
      process(makeInclusionList(3, [txB]), true);

      const indices = BitArray.fromBoolArray(
        Array.from({length: INCLUSION_LIST_COMMITTEE_SIZE}, (_, i) => i === 0 || i === 2)
      );
      expect(store.getByIndices(slot, dependentRootHex, indices)).toEqual([untimely]);
    });
  });

  describe("prune", () => {
    it("retains MIN_SLOTS_FOR_INCLUSION_LISTS_REQUESTS slots beyond the inclusion list slot", () => {
      process(makeInclusionList(1, [txA]), true);

      store.prune(slot + 1);
      expect(store.size).toBe(1);

      store.prune(slot + 2);
      expect(store.size).toBe(0);
    });

    it("rejects inclusion lists below the prune horizon", () => {
      store.prune(slot + 2);

      expect(process(makeInclusionList(1, [txA]), true)).toBe(InclusionListInsertOutcome.Old);
      expect(store.size).toBe(0);
    });

    it("forgets the first-or-second rule counters of pruned slots", () => {
      process(makeInclusionList(1, [txA]), true);
      process(makeInclusionList(1, [txB]), true);
      expect(store.seenTwice(slot, 1)).toBe(true);

      store.prune(slot + 2);
      expect(store.seenTwice(slot, 1)).toBe(false);
    });
  });
});
