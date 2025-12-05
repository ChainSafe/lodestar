import {randomBytes} from "crypto";
import {describe, expect, it} from "vitest";
import snappyWasm from "@chainsafe/snappy-wasm";
import {getSnappyDecompressor} from "../../../../src/network/gossip/snappy/index.js";
import {GossipType} from "../../../../src/network/index.js";

const encoder = new snappyWasm.Encoder();

function compress(data: Uint8Array): Uint8Array {
  const compressedData = Buffer.allocUnsafe(snappyWasm.max_compress_len(data.length));
  const compressedLen = encoder.compress_into(data, compressedData);
  return compressedData.subarray(0, compressedLen);
}

describe("snappy", () => {
  const lengths = [0, 1, 10, 100, 1000, 10000, 100000];
  for (const length of lengths) {
    it(`should decompress data of length ${length} compressed by snappy-wasm`, () => {
      const buffer = randomBytes(length);
      const compressed = compress(buffer);
      for (const gossipType of [GossipType.beacon_attestation, GossipType.beacon_block]) {
        const decompressor = getSnappyDecompressor(gossipType, compressed);
        const uncompressedLength = decompressor.readUncompressedLength();
        expect(uncompressedLength).toBe(length);
        const out = new Uint8Array(length);
        const success = decompressor.uncompressInto(out);
        expect(success).toBe(true);
        expect(out).toEqual(new Uint8Array(buffer));
      }
    });
  }
});
