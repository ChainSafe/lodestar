import {describe, expect, it} from "vitest";
import {ssz} from "../../src/index.js";

describe("UintNum64 deserialization", () => {
  it("decodes Number.MAX_SAFE_INTEGER exactly", () => {
    const bytes = ssz.UintBn64.serialize(2n ** 53n - 1n);
    expect(ssz.UintNum64.deserialize(bytes)).toBe(Number.MAX_SAFE_INTEGER);
    expect(ssz.UintNumInf64.deserialize(bytes)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("decodes 2^64-1 as Infinity for UintNumInf64", () => {
    expect(ssz.UintNumInf64.deserialize(ssz.UintBn64.serialize(2n ** 64n - 1n))).toBe(Infinity);
  });

  it.each([2n ** 53n, 2n ** 64n - 2n, 2n ** 64n - 1n])("UintNum64 rejects %s", (value) => {
    expect(() => ssz.UintNum64.deserialize(ssz.UintBn64.serialize(value))).toThrow();
  });

  it.each([2n ** 53n, 2n ** 64n - 2n])("UintNumInf64 rejects %s", (value) => {
    expect(() => ssz.UintNumInf64.deserialize(ssz.UintBn64.serialize(value))).toThrow();
  });

  it("rejects an unsafe uint64 field in a container", () => {
    const bytes = ssz.electra.Attestation.serialize(ssz.electra.Attestation.defaultValue());
    // data.index follows the 4 byte aggregation_bits offset and the 8 byte data.slot
    bytes.set(ssz.UintBn64.serialize(2n ** 64n - 2n), 12);
    expect(() => ssz.electra.Attestation.deserialize(bytes)).toThrow();
    expect(() => ssz.electra.Attestation.deserializeToViewDU(bytes)).toThrow();
  });
});
