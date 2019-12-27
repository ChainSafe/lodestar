import {BitList} from "@chainsafe/bit-utils";
import {getBitCount} from "../../../src/util/bit";
import {expect} from "chai";

describe("bit utils", function () {

  it("test get bit count", function () {
    const bitlist = BitList.fromBitfield(new Uint8Array(8), 57);
    bitlist.setBit(5, true);
    expect(getBitCount(bitlist)).to.be.equal(1);
  });
    
});