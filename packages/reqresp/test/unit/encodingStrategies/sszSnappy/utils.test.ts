import {expect} from "chai";
import {maxEncodedLen} from "../../../../src/encodingStrategies/sszSnappy/utils.js";

describe("encodingStrategies / sszSnappy / utils", () => {
  describe("maxEncodedLen", () => {
    it("should calculate correct maxEncodedLen", () => {
      expect(maxEncodedLen(6)).to.be.equal(39);
    });
  });
});
