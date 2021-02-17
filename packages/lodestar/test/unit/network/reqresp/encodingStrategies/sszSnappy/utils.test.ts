import {expect} from "chai";
import {maxEncodedLen} from "../../../../../../src/network/reqresp/encodingStrategies/sszSnappy/utils";

describe("network / reqresp / sszSnappy / utils", () => {
  describe("maxEncodedLen", () => {
    it("should calculate correct maxEncodedLen", () => {
      expect(maxEncodedLen(6)).to.be.equal(39);
    });
  });
});
