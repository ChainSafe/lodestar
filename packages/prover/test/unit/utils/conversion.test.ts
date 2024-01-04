import {describe, it, expect} from "vitest";
import {chunkIntoN} from "../../../src/utils/conversion.js";

describe("utils/conversion", () => {
  describe("chunkIntoN", () => {
    const testCases = [
      {
        title: "even number of chunks",
        input: {
          data: [1, 2, 3, 4, 5, 6],
          n: 2,
        },
        output: [
          [1, 2],
          [3, 4],
          [5, 6],
        ],
      },
      {
        title: "even number of chunks with additional element",
        input: {
          data: [1, 2, 3, 4, 5, 6, 7],
          n: 2,
        },
        output: [[1, 2], [3, 4], [5, 6], [7]],
      },
      {
        title: "odd number of chunks",
        input: {
          data: [1, 2, 3, 4, 5, 6],
          n: 3,
        },
        output: [
          [1, 2, 3],
          [4, 5, 6],
        ],
      },
      {
        title: "odd number of chunks with additional element",
        input: {
          data: [1, 2, 3, 4, 5, 6, 7],
          n: 3,
        },
        output: [[1, 2, 3], [4, 5, 6], [7]],
      },
      {
        title: "data less than chunk size",
        input: {
          data: [1],
          n: 3,
        },
        output: [[1]],
      },
      {
        title: "data 1 less than chunk size",
        input: {
          data: [1, 2],
          n: 3,
        },
        output: [[1, 2]],
      },
      {
        title: "data 1 extra than chunk size",
        input: {
          data: [1, 2, 3, 4],
          n: 3,
        },
        output: [[1, 2, 3], [4]],
      },
    ];

    for (const {title, input, output} of testCases) {
      it(`should chunkify data when ${title}`, async () => {
        expect(chunkIntoN(input.data, input.n)).toEqual(output);
      });
    }

    it("should not change the order of elements", () => {
      expect(chunkIntoN([6, 5, 4, 3, 2, 1], 2)).toEqual([
        [6, 5],
        [4, 3],
        [2, 1],
      ]);
    });
  });
});
