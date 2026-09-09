import {describe, expect, it} from "vitest";
import {MAX_BLOB_COMMITMENTS_PER_BLOCK} from "@lodestar/params";
import {ssz} from "../../src/index.js";

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
