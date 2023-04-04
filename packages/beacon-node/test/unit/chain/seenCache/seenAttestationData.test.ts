import {expect} from "chai";
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

  const addTestCases: {slot: number; attDataHash: string; expected: InsertOutcome}[] = [
    {slot: 98, attDataHash: "98a", expected: InsertOutcome.Old},
    {slot: 99, attDataHash: "99a", expected: InsertOutcome.AlreadyKnown},
    {slot: 99, attDataHash: "99c", expected: InsertOutcome.ReachLimit},
    {slot: 100, attDataHash: "100b", expected: InsertOutcome.NewData},
  ];

  for (const testCase of addTestCases) {
    it(`add slot ${testCase.slot} data ${testCase.attDataHash} should return ${testCase.expected}`, () => {
      expect(
        cache.add(testCase.slot, testCase.attDataHash, {
          attDataRootHex: testCase.attDataHash,
        } as AttestationDataCacheEntry)
      ).to.equal(testCase.expected);
    });
  }

  const getTestCases: {slot: number; attDataHash: string; expectedNull: boolean}[] = [
    {slot: 98, attDataHash: "98a", expectedNull: true},
    {slot: 99, attDataHash: "99unknown", expectedNull: true},
    {slot: 99, attDataHash: "99a", expectedNull: false},
  ];

  for (const testCase of getTestCases) {
    it(`get slot ${testCase.slot} data ${testCase.attDataHash} should return ${
      testCase.expectedNull ? "null" : "not null"
    }`, () => {
      if (testCase.expectedNull) {
        expect(cache.get(testCase.slot, testCase.attDataHash)).to.be.null;
      } else {
        expect(cache.get(testCase.slot, testCase.attDataHash)).to.not.be.null;
      }
    });
  }
});
