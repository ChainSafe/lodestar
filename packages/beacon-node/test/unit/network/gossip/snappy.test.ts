import {randomBytes} from "crypto";
import {compress as snappyJsCompress} from "snappyjs";
import {describe, expect, it} from "vitest";
import {getSnappyDecompressor} from "../../../../src/network/gossip/snappy/index.js";
import {GossipType} from "../../../../src/network/index.js";

describe("snappy", () => {
  const lengths = [0, 1, 10, 100, 1000, 10000, 100000];
  for (const length of lengths) {
    it(`should decompress data of length ${length} compressed by snappyjs`, () => {
      const buffer = randomBytes(length);
      const compressed = snappyJsCompress(buffer);
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
