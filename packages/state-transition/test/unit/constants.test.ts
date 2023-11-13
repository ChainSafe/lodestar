import {describe, it, expect} from "vitest";
import {Signature} from "@chainsafe/blst-ts";
import {G2_POINT_AT_INFINITY} from "../../src/index.js";

describe("constants", () => {
  it("G2_POINT_AT_INFINITY", () => {
    const p2 = Signature.deserialize(G2_POINT_AT_INFINITY);
    expect(p2.sigValidate()).toBeUndefined();
    // TODO: (matthewkeil) is_inf is not implemented and sigValidate is
    //       valid for g2 at infinity
    // expect(p2.value.is_inf()).to.equal(true, "is not infinity");
  });
});
