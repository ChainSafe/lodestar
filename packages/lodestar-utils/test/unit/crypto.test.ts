import {hash} from "../../src/crypto";
import {expect} from "chai";
import {describe, it} from "mocha";

describe("test hash function", () => {

  it("should return correct hash", () => {
    const result = hash(Buffer.from("1a", "hex"));
    expect(result.toString("hex")).to.be.equal("58f7b0780592032e4d8602a3e8690fb2c701b2e1dd546e703445aabd6469734d");
  });

});