import {BitArray} from "@chainsafe/ssz";
import {describe, it, expect} from "vitest";
import {
  AggregationInfo,
  insertDesc,
  SeenAggregatedAttestations,
} from "../../../../src/chain/seenCache/seenAggregateAndProof.js";

describe("SeenAggregatedAttestations.isKnown", () => {
  const testCases: {
    id: string;
    seenAttestingBits: number[];
    checkAttestingBits: {bits: number[]; isKnown: boolean}[];
  }[] = [
    // Note: attestationsToAdd MUST intersect in order to not be aggregated and distort the results
    {
      id: "All have attested",
      seenAttestingBits: [0b11111111],
      checkAttestingBits: [
        {bits: [0b11111110], isKnown: true},
        {bits: [0b00000011], isKnown: true},
      ],
    },
    {
      id: "Some have attested",
      seenAttestingBits: [0b11110001], // equals to indexes [ 0, 4, 5, 6, 7 ]
      checkAttestingBits: [
        {bits: [0b11111110], isKnown: false},
        {bits: [0b00000011], isKnown: false},
        {bits: [0b11010001], isKnown: true},
      ],
    },
    {
      id: "Non have attested",
      seenAttestingBits: [0b00000000],
      checkAttestingBits: [
        {bits: [0b11111110], isKnown: false},
        {bits: [0b00000011], isKnown: false},
      ],
    },
  ];

  const targetEpoch = 10;
  const attDataRoot = "0x";

  for (const {id, seenAttestingBits, checkAttestingBits} of testCases) {
    it(id, () => {
      const cache = new SeenAggregatedAttestations(null);
      const aggregationBits = new BitArray(new Uint8Array(seenAttestingBits), 8);
      cache.add(
        targetEpoch,
        attDataRoot,
        {aggregationBits, trueBitCount: aggregationBits.getTrueBitIndexes().length},
        false
      );
      for (const {bits, isKnown} of checkAttestingBits) {
        // expect(cache.participantsKnown(subsetContribution)).to.equal(isKnown);
        const toCheckAggBits = new BitArray(new Uint8Array(bits), 8);
        expect(cache.isKnown(targetEpoch, attDataRoot, toCheckAggBits)).toBe(isKnown);
      }
    });
  }
});

describe("insertDesc", () => {
  const testCases: {
    id: string;
    arr: number[][];
    bits: number[];
    result: number[][];
  }[] = [
    {
      id: "Insert first",
      arr: [[0b11110001], [0b11100001]],
      bits: [0b11110001],
      result: [[0b11110001], [0b11110001], [0b11100001]],
    },
    {
      id: "Insert second",
      arr: [[0b11110001], [0b00000001]],
      bits: [0b00010001],
      result: [[0b11110001], [0b00010001], [0b00000001]],
    },
    {
      id: "Insert last",
      arr: [[0b11110001], [0b00000011]],
      bits: [0b00000001],
      result: [[0b11110001], [0b00000011], [0b00000001]],
    },
  ];

  const toAggregationBits = (bits: number[]): AggregationInfo => {
    const aggregationBits = new BitArray(new Uint8Array(bits), 8);
    return {
      aggregationBits,
      trueBitCount: aggregationBits.getTrueBitIndexes().length,
    };
  };

  for (const {id, arr, bits, result} of testCases) {
    it(id, () => {
      const seenAggregationInfoArr = arr.map(toAggregationBits);

      insertDesc(seenAggregationInfoArr, toAggregationBits(bits));
      expect(seenAggregationInfoArr).toEqual(result.map(toAggregationBits));
    });
  }
});
