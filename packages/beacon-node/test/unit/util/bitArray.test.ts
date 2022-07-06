import {expect} from "chai";
import {IntersectResult, intersectUint8Arrays} from "../../../src/util/bitArray.js";

describe("util / bitArray / intersectUint8Arrays", () => {
  const testCases: {id?: string; a: number[]; b: number[]; res: IntersectResult}[] = [
    // Single byte
    {a: [0b00000000], b: [0b00000000], res: IntersectResult.Equal},
    {a: [0b00001111], b: [0b00001111], res: IntersectResult.Equal},
    {a: [0b00001111], b: [0b00000011], res: IntersectResult.Superset},
    {a: [0b00000011], b: [0b00001111], res: IntersectResult.Subset},
    {a: [0b00000011], b: [0b11110000], res: IntersectResult.Exclusive},
    {a: [0b00111111], b: [0b11111100], res: IntersectResult.Intersect},
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
  ];

  for (const {id, a, b, res} of testCases) {
    it(id ?? toId(a, b), () => {
      const aUA = new Uint8Array(a);
      const bUA = new Uint8Array(b);

      // Use IntersectResult[] to get the actual name of IntersectResult
      expect(IntersectResult[intersectUint8Arrays(aUA, bUA)]).to.equal(IntersectResult[res]);
    });
  }
});

function toId(a: number[], b: number[]): string {
  return [a, b].map((arr) => arr.map((n) => n.toString(2).padStart(8, "0")).join(",")).join(" - ");
}
