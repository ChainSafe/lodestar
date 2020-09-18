import {expect} from "chai";
import {binarySearchLte, ErrorNoValues, ErrorNoValueMinValue} from "../../../src/util/binarySearch";

describe("util / binarySearch", () => {
  describe("binarySearchLte", () => {
    type T = {n: number; id: string};
    const testCases: {
      id: string;
      items: T[];
      value: number;
      expectedId?: string;
      error?: any;
    }[] = [
      {
        id: "Single value case 1",
        items: [{n: 0, id: "a"}],
        value: 0,
        expectedId: "a",
      },
      {
        id: "Single value case 2",
        items: [{n: 0, id: "a"}],
        value: 1,
        expectedId: "a",
      },
      {
        id: "Regular case 1",
        items: [
          {n: 0, id: "a"},
          {n: 5, id: "b"},
          {n: 10, id: "c"},
        ],
        value: 4,
        expectedId: "a",
      },
      {
        id: "Regular case 2",
        items: [
          {n: 0, id: "a"},
          {n: 5, id: "b"},
          {n: 10, id: "c"},
        ],
        value: 5,
        expectedId: "b",
      },
      {
        id: "Regular case 3",
        items: [
          {n: 0, id: "a"},
          {n: 5, id: "b"},
          {n: 10, id: "c"},
        ],
        value: 14,
        expectedId: "c",
      },
      {
        id: "Empty array",
        items: [],
        value: 0,
        error: ErrorNoValues,
      },
      {
        id: "No possible value",
        items: [{n: 0, id: "a"}],
        value: -1,
        error: ErrorNoValueMinValue,
      },
    ];

    const getter = (item: T): number => item.n;

    for (const {id, items, value, expectedId, error} of testCases) {
      it(id, () => {
        if (expectedId) {
          const result = binarySearchLte(items, value, getter);
          expect(result.id).to.equal(expectedId);
        } else if (error) {
          expect(() => binarySearchLte(items, value, getter)).to.throw(error);
        } else {
          throw Error("Test case must have 'expectedId' or 'error'");
        }
      });
    }

    const length = 1000;
    it(`Stress test: search in ${length} items, ${length} times.`, () => {
      const items = Array.from({length}, (_, i) => i);
      for (let i = 0; i < length; i++) {
        const result = binarySearchLte(items, i, (n) => n);
        expect(result).to.equal(i);
      }
    });
  });
});
