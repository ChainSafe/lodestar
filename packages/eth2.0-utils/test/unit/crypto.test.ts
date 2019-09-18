import {describe, it} from "mocha";
import {Hash, hash} from "../../src/crypto";
import {expect} from "chai";

describe("test hash function", () => {

  it("should return correct hash", () => {
    const result = hash(Buffer.from("1a", "hex"));
    expect(result.toString("hex")).to.be.equal("58f7b0780592032e4d8602a3e8690fb2c701b2e1dd546e703445aabd6469734d");
  });

  describe("test hash class", () => {
    it("should return correct hash", () => {
      const newHash = new Hash();
      newHash.update(Buffer.from("1a", "hex"));
      newHash.update(Buffer.from("1a", "hex"));
      const result = newHash.finish();
      expect(result.toString("hex")).to.be.equal("14541df1f60e270f637925ab6fc4094d1f1751b73f9748b09480664e743f559c");
    });
  });

});