import {expect} from "chai";
import {mapToObj} from "../../utils/map";
import {backfillMap} from "../../../src/util/map";

describe("util / map", () => {
  describe("backfillMap", () => {
    const testCases: {
      id: string;
      map: Map<number, any>;
      toIndex: number;
      expectedResult: Map<number, any>;
    }[] = [
      {
        id: "Single value case",
        map: new Map([[0, "A"]]),
        toIndex: 2,
        expectedResult: new Map([
          [0, "A"],
          [1, "A"],
          [2, "A"],
        ]),
      },
      {
        id: "Multiple values case",
        map: new Map([
          [0, "A"],
          [3, "B"],
          [5, "C"],
        ]),
        toIndex: 7,
        expectedResult: new Map([
          [0, "A"],
          [1, "A"],
          [2, "A"],
          [3, "B"],
          [4, "B"],
          [5, "C"],
          [6, "C"],
          [7, "C"],
        ]),
      },
      {
        id: "Empty map",
        map: new Map(),
        toIndex: 0,
        expectedResult: new Map(),
      },
    ];

    for (const {id, map, toIndex, expectedResult} of testCases) {
      it(id, () => {
        const backfilledMap = backfillMap(map, toIndex);
        expect(mapToObj(backfilledMap)).to.deep.equal(mapToObj(expectedResult));
      });
    }
  });
});
