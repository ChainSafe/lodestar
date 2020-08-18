import {expect} from "chai";
import {maxEncodedLen} from "../../../../src/network/encoders/utils";
import {ReqRespEncoding} from "../../../../src/constants";

describe("Utils of network request/response encoding", () => {
  it("should calculate correct maxEncodedLen", () => {
    expect(maxEncodedLen(6, ReqRespEncoding.SSZ)).to.be.equal(6);
    expect(maxEncodedLen(6, ReqRespEncoding.SSZ_SNAPPY)).to.be.equal(39);
  });
});