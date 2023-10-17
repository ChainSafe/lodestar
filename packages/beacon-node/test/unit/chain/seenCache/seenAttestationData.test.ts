import {describe, it, expect, beforeEach} from "vitest";
import {InsertOutcome} from "../../../../src/chain/opPools/types.js";
import {AttestationDataCacheEntry, SeenAttestationDatas} from "../../../../src/chain/seenCache/seenAttestationData.js";

// Compare this snippet from packages/beacon-node/src/chain/seenCache/seenAttestationData.ts:
describe("SeenAttestationDatas", () => {
  // Only accept AttestationData from current slot or previous slot
  // Max cache size per slot is 2
  let cache: SeenAttestationDatas;

  beforeEach(() => {
    cache = new SeenAttestationDatas(null, 1, 2);
    cache.onSlot(100);
    cache.add(99, "99a", {attDataRootHex: "99a"} as AttestationDataCacheEntry);
    cache.add(99, "99b", {attDataRootHex: "99b"} as AttestationDataCacheEntry);
    cache.add(100, "100a", {attDataRootHex: "100a"} as AttestationDataCacheEntry);
  });

  const addTestCases: {slot: number; attDataBase64: string; expected: InsertOutcome}[] = [
    {slot: 98, attDataBase64: "98a", expected: InsertOutcome.Old},
    {slot: 99, attDataBase64: "99a", expected: InsertOutcome.AlreadyKnown},
    {slot: 99, attDataBase64: "99c", expected: InsertOutcome.ReachLimit},
    {slot: 100, attDataBase64: "100b", expected: InsertOutcome.NewData},
  ];

  for (const testCase of addTestCases) {
    it(`add slot ${testCase.slot} data ${testCase.attDataBase64} should return ${testCase.expected}`, () => {
      expect(
        cache.add(testCase.slot, testCase.attDataBase64, {
          attDataRootHex: testCase.attDataBase64,
        } as AttestationDataCacheEntry)
      ).toBe(testCase.expected);
    });
  }

  const getTestCases: {slot: number; attDataBase64: string; expectedNull: boolean}[] = [
    {slot: 98, attDataBase64: "98a", expectedNull: true},
    {slot: 99, attDataBase64: "99unknown", expectedNull: true},
    {slot: 99, attDataBase64: "99a", expectedNull: false},
  ];

  for (const testCase of getTestCases) {
    it(`get slot ${testCase.slot} data ${testCase.attDataBase64} should return ${
      testCase.expectedNull ? "null" : "not null"
    }`, () => {
      if (testCase.expectedNull) {
        expect(cache.get(testCase.slot, testCase.attDataBase64)).toBeNull();
      } else {
        expect(cache.get(testCase.slot, testCase.attDataBase64)).not.toBeNull();
      }
    });
  }
});
