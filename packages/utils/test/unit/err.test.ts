import {expect} from "chai";
import {Err, isErr, mapOkResults, mapOkResultsAsync, Result} from "../../src/err.js";
import {expectDeepEquals, expectEquals} from "../utils/chai.js";

/* eslint-disable @typescript-eslint/no-unsafe-assignment */

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
      // eslint-disable-next-line @typescript-eslint/no-empty-function
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
        expectEquals(isErr(value as Result<any, Error>), false);
      });
      it(`${i} Err(${String(value)})`, () => {
        // Any value can be wrapped in Err
        expectEquals(isErr(Err(value as Result<any, Error>)), true);
      });
    }
  });

  describe("mapOkResults", () => {
    it("empty case", () => {
      expectDeepEquals(
        mapOkResults([], () => []),
        []
      );
    });

    it("throw for different length", () => {
      expect(() => mapOkResults([], () => [0])).to.throw();
    });

    it("num to string mixed results", () => {
      const results0: Result<number, number>[] = [0, Err(1), 2, Err(3), 4, 5, 6, Err(7)];
      const results1 = mapOkResults(results0, (resultsOk) =>
        resultsOk.map((num) => (num >= 5 ? Err(num) : String(num)))
      );
      expectDeepEquals(results1, ["0", Err(1), "2", Err(3), "4", Err(5), Err(6), Err(7)]);
    });
  });

  describe("mapOkResultsAsync", () => {
    it("empty case", async () => {
      expectDeepEquals(await mapOkResultsAsync([], async () => []), []);
    });

    it("reject for different length", async () => {
      try {
        await mapOkResultsAsync([], async () => [0]);
        throw Error("did not throw");
      } catch (e) {
        // Ok
      }
    });

    it("num to string mixed results", async () => {
      const results0: Result<number, number>[] = [0, Err(1), 2, Err(3), 4, 5, 6, Err(7)];
      const results1 = await mapOkResultsAsync(results0, async (resultsOk) =>
        resultsOk.map((num) => (num >= 5 ? Err(num) : String(num)))
      );
      expectDeepEquals(results1, ["0", Err(1), "2", Err(3), "4", Err(5), Err(6), Err(7)]);
    });
  });
});
