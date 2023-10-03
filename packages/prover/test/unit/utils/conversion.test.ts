import {expect} from "chai";
import {chunkIntoN} from "../../../src/utils/conversion.js";

describe("utils/conversion", () => {
  describe("chunkIntoN", () => {
    it("should return true if splitting into chunks correctly", async () => {
      expect(chunkIntoN([1, 2, 3, 4, 5, 6], 2)).to.be.deep.eq([
        [1, 2],
        [3, 4],
        [5, 6],
      ]);
    });
  });
});
