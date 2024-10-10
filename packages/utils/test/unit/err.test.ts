import {describe, it, expect} from "vitest";
import {Err, isErr, mapOkResults, mapOkResultsAsync, Result} from "../../src/err.js";

describe("Result Err", () => {
  describe("isErr works with any type", () => {
    const values: any[] = [
      "string",
      0,
      BigInt(0),
      true,
      undefined,
      Symbol("symbol"),
      null,
      [1, 2],
      new Uint8Array(1),
      function test() {},
      {a: 1},
      new AbortController(),
      {a: 1},
      {error: true},
      new Error("test error"),
    ];

    for (const [i, value] of values.entries()) {
      it(`${i} Ok(${String(value)})`, () => {
        // Any value must not be detected as error
        expect(isErr(value)).toBeFalsy();
      });
      it(`${i} Err(${String(value)})`, () => {
        // Any value can be wrapped in Err
        expect(isErr(Err(value))).toBeTruthy();
      });
    }
  });

  describe("mapOkResults", () => {
    it("empty case", () => {
      expect(mapOkResults([], () => [])).toEqual([]);
    });

    it("throw for different length", () => {
      expect(() => mapOkResults([], () => [0])).toThrow();
    });

    it("num to string mixed results", () => {
      const results0: Result<number, number>[] = [0, Err(1), 2, Err(3), 4, 5, 6, Err(7)];
      const results1 = mapOkResults(results0, (resultsOk) =>
        resultsOk.map((num) => (num >= 5 ? Err(num) : String(num)))
      );
      expect(results1).toEqual(["0", Err(1), "2", Err(3), "4", Err(5), Err(6), Err(7)]);
    });
  });

  describe("mapOkResultsAsync", () => {
    it("empty case", async () => {
      expect(await mapOkResultsAsync([], async () => [])).toEqual([]);
    });

    it("reject for different length", async () => {
      try {
        await mapOkResultsAsync([], async () => [0]);
        throw Error("did not throw");
      } catch (_e) {
        // Ok
      }
    });

    it("num to string mixed results", async () => {
      const results0: Result<number, number>[] = [0, Err(1), 2, Err(3), 4, 5, 6, Err(7)];
      const results1 = await mapOkResultsAsync(results0, async (resultsOk) =>
        resultsOk.map((num) => (num >= 5 ? Err(num) : String(num)))
      );
      expect(results1).toEqual(["0", Err(1), "2", Err(3), "4", Err(5), Err(6), Err(7)]);
    });
  });
});
