import {expect} from "chai";
import * as blst from "@chainsafe/blst";
import {G2_POINT_AT_INFINITY} from "../../src/index.js";

describe("constants", () => {
  it("G2_POINT_AT_INFINITY", () => {
    const p2 = blst.Signature.fromBytes(G2_POINT_AT_INFINITY);
    expect(p2.value.is_inf()).to.equal(true, "is not infinity");
  });
});
