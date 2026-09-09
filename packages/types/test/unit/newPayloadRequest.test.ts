import {describe, expect, it} from "vitest";
import {fromHexString, toHexString} from "@chainsafe/ssz";
import {ForkName, MAX_BLOB_COMMITMENTS_PER_BLOCK} from "@lodestar/params";
import {ssz, sszTypesFor} from "../../src/index.js";
import fixtures from "../fixtures/newPayloadRequest.json" with {type: "json"};

// Mainnet fixtures generated with consensus-specs PR #5619 at acd7a7f146ebabb9f8188e9f4ef92f2bf0e6f0cf.
describe("NewPayloadRequest", () => {
  for (const fork of [
    ForkName.bellatrix,
    ForkName.capella,
    ForkName.deneb,
    ForkName.electra,
    ForkName.fulu,
    ForkName.gloas,
    ForkName.heze,
  ] as const) {
    it(`matches the ${fork} spec serialization and root`, () => {
      const type = sszTypesFor(fork, "NewPayloadRequest");
      const {value, serialized, root} = fixtures[fork];
      const request = type.fromJson(value);

      expect(toHexString(type.serialize(request))).toBe(serialized);
      expect(type.toJson(type.deserialize(fromHexString(serialized)))).toEqual(value);
      expect(toHexString(type.hashTreeRoot(request))).toBe(root);
      expect(toHexString(type.toViewDU(request).hashTreeRoot())).toBe(root);
    });
  }
});

describe("VersionedHashes", () => {
  it("accepts the maximum number of versioned hashes", () => {
    const bytes = new Uint8Array(MAX_BLOB_COMMITMENTS_PER_BLOCK * 32);
    expect(ssz.deneb.VersionedHashes.deserialize(bytes)).toHaveLength(MAX_BLOB_COMMITMENTS_PER_BLOCK);
  });

  it("rejects versioned hashes above the SSZ limit", () => {
    const bytes = new Uint8Array((MAX_BLOB_COMMITMENTS_PER_BLOCK + 1) * 32);
    expect(() => ssz.deneb.VersionedHashes.deserialize(bytes)).toThrow();
  });
});
