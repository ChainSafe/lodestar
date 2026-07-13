import {describe, expect, it} from "vitest";
import * as blst from "../../src/bls/index.js";
import {G2_POINT_AT_INFINITY} from "../../src/index.js";

describe("constants", () => {
  it("G2_POINT_AT_INFINITY", () => {
    expect(() => blst.Signature.fromBytes(G2_POINT_AT_INFINITY, true)).toThrow();
  });
});
