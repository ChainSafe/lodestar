import {describe, expect, it} from "vitest";
import {getBlobIndicesByVersionedHashes} from "../../../../../../src/api/impl/beacon/blocks/utils.js";

describe("api - beacon - blocks utils", () => {
  it("returns every matching blob index in request order", () => {
    expect(getBlobIndicesByVersionedHashes(["0xaa", "0xbb", "0xaa", "0xcc"], ["0xbb", "0xaa"])).toEqual([1, 0, 2]);
  });

  it("throws when a requested versioned hash is missing", () => {
    expect(() => getBlobIndicesByVersionedHashes(["0xaa"], ["0xbb"])).toThrow("Versioned hash 0xbb not found in block");
  });
});
