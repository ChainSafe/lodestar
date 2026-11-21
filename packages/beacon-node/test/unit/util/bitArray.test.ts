import {describe, expect, it} from "vitest";
import {BitArray} from "@chainsafe/ssz";
import {
  IntersectResult,
  countTrueBits,
  intersectUint8Arrays,
  isSuperSetOrEqual,
  sliceBitArray,
} from "../../../src/util/bitArray.js";

describe("util / bitArray / intersectUint8Arrays", () => {
  const testCases: {id?: string; a: number[]; b: number[]; res: IntersectResult}[] = [
    // Single byte
    {a: [0b00000000], b: [0b00000000], res: IntersectResult.Equal},
    {a: [0b00001111], b: [0b00001111], res: IntersectResult.Equal},
    {a: [0b00001111], b: [0b00000011], res: IntersectResult.Superset},
    {a: [0b00000011], b: [0b00001111], res: IntersectResult.Subset},
    {a: [0b00000011], b: [0b11110000], res: IntersectResult.Exclusive},
    {a: [0b00111111], b: [0b11111100], res: IntersectResult.Intersect},
    {a: [0b00001111], b: [0b00000000], res: IntersectResult.Superset},
    {a: [0b00000000], b: [0b00001111], res: IntersectResult.Subset},
    // Multi-byte
    {
      a: [0b00000000, 0b00000000, 0b00001111, 0b00001111],
      b: [0b00000000, 0b00000000, 0b00001111, 0b00001111],
      res: IntersectResult.Equal,
    },
    {
      // zero         equal       superset    superset
      a: [0b00000000, 0b11111111, 0b11111111, 0b11110000],
      b: [0b00000000, 0b11111111, 0b00111100, 0b11000000],
      res: IntersectResult.Superset,
    },
    {
      // zero         equal       subset    subset
      a: [0b00000000, 0b11111111, 0b00111100, 0b11000000],
      b: [0b00000000, 0b11111111, 0b11111111, 0b11110000],
      res: IntersectResult.Subset,
    },
    {
      // zero         exclusive   exclusive   zero
      a: [0b00000000, 0b00001111, 0b11110000, 0b00000000],
      b: [0b00000000, 0b11110000, 0b00001111, 0b00000000],
      res: IntersectResult.Exclusive,
    },
    {
      // zero         equal       superset    subset
      a: [0b00000000, 0b11111111, 0b11111111, 0b11000000],
      b: [0b00000000, 0b11111111, 0b00111100, 0b11110000],
      res: IntersectResult.Intersect,
    },
    {
      // zero         equal       exclusive    exclusive
      a: [0b00000000, 0b11111111, 0b00001111, 0b11110000],
      b: [0b00000000, 0b11111111, 0b11110000, 0b00001111],
      res: IntersectResult.Intersect,
    },
    {
      // zero         superset    exclusive    exclusive
      a: [0b00000000, 0b11111111, 0b00001111, 0b11110000],
      b: [0b00000000, 0b00111100, 0b11110000, 0b00001111],
      res: IntersectResult.Intersect,
    },
    {
      // superset     only a
      a: [0b11111111, 0b00001111],
      b: [0b00001111, 0b00000000],
      res: IntersectResult.Superset,
    },
    {
      // only a       superset
      a: [0b11110000, 0b11111111],
      b: [0b00000000, 0b00000011],
      res: IntersectResult.Superset,
    },
    {
      // subset       only b
      a: [0b00001111, 0b00000000],
      b: [0b11111111, 0b00001111],
      res: IntersectResult.Subset,
    },
    {
      // only a       only b
      a: [0b00001111, 0b00000000],
      b: [0b00000000, 0b11110000],
      res: IntersectResult.Exclusive,
    },
    {
      // superset     only a      only b
      a: [0b11111111, 0b00001111, 0b00000000],
      b: [0b00001111, 0b00000000, 0b11110000],
      res: IntersectResult.Intersect,
    },
    {id: "a longer than b", a: [0b00001111, 0b00000001], b: [0b00001111], res: IntersectResult.Superset},
    {id: "b longer than a", a: [0b00001111], b: [0b00001111, 0b00000001], res: IntersectResult.Subset},
  ];

  for (const {id, a, b, res} of testCases) {
    it(id ?? toId(a, b), () => {
      const aUA = new Uint8Array(a);
      const bUA = new Uint8Array(b);

      // Use IntersectResult[] to get the actual name of IntersectResult
      expect(IntersectResult[intersectUint8Arrays(aUA, bUA)]).toBe(IntersectResult[res]);
    });
  }
});

describe("util / bitArray / isSuperSetOrEqual", () => {
  it("superset that leaves a byte of the subset empty", () => {
    const superSet = new BitArray(new Uint8Array([0b11111111, 0b00001111]), 16);
    const toCheck = new BitArray(new Uint8Array([0b00001111, 0b00000000]), 16);
    expect(isSuperSetOrEqual(superSet, toCheck)).toBe(true);
  });

  it("different bit lengths are never a superset", () => {
    const superSet = new BitArray(new Uint8Array([0b11111111]), 8);
    const toCheck = new BitArray(new Uint8Array([0b00001111]), 7);
    expect(isSuperSetOrEqual(superSet, toCheck)).toBe(false);
  });
});

function toId(a: number[], b: number[]): string {
  return [a, b].map((arr) => arr.map((n) => n.toString(2).padStart(8, "0")).join(",")).join(" - ");
}

describe("util / bitArray / sliceBitArray", () => {
  const sourceBools = Array.from({length: 77}, (_, i) => (i * 7) % 3 === 0 || i % 11 === 0);
  const source = BitArray.fromBoolArray(sourceBools);

  it("matches a boolean array slice for every start and length", () => {
    for (let start = 0; start <= sourceBools.length; start++) {
      for (let bitLen = 0; start + bitLen <= sourceBools.length; bitLen++) {
        const expected = BitArray.fromBoolArray(sourceBools.slice(start, start + bitLen));
        const sliced = sliceBitArray(source, start, bitLen);
        expect(sliced.bitLen).toBe(bitLen);
        expect(sliced.uint8Array, `wrong bytes for start ${start} bitLen ${bitLen}`).toEqual(expected.uint8Array);
      }
    }
  });

  it("does not alias the source bytes", () => {
    const sliced = sliceBitArray(source, 8, 16);
    sliced.set(0, !sliced.get(0));
    expect(source.toBoolArray()).toEqual(sourceBools);
  });

  it("throws on a range past the end of the source", () => {
    expect(() => sliceBitArray(source, 70, 8)).toThrow();
    expect(() => sliceBitArray(source, -1, 8)).toThrow();
  });
});

describe("util / bitArray / countTrueBits", () => {
  it("matches getTrueBitIndexes for every bit length", () => {
    for (let bitLen = 0; bitLen <= 40; bitLen++) {
      const bitArray = BitArray.fromBoolArray(Array.from({length: bitLen}, (_, i) => i % 3 !== 1));
      expect(countTrueBits(bitArray), `wrong count for bitLen ${bitLen}`).toBe(bitArray.getTrueBitIndexes().length);
    }
  });

  it("counts a full byte range", () => {
    expect(countTrueBits(new BitArray(new Uint8Array([0xff, 0x00, 0x81]), 24))).toBe(10);
  });
});
