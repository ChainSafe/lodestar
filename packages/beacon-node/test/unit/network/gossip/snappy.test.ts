import {randomBytes} from "crypto";
import {compress as snappyJsCompress, uncompress as snappyJsUncompress} from "snappyjs";
import {describe, expect, it} from "vitest";
import {compress, uncompress} from "../../../../src/network/gossip/snappy/index.js";

describe("snappy", () => {
  const lengths = [0, 1, 10, 100, 1000, 10000, 100000];
  const maxLength = 1000000;
  for (const length of lengths) {
    it(`should compress and uncompress data of length ${length}`, () => {
      const buffer = randomBytes(length);
      const uint8array = new Uint8Array(buffer);

      for (const buf of [buffer, uint8array]) {
        const compressed = compress(buf);
        const expectedCompressed = snappyJsCompress(buf);
        expect(compressed).toEqual(expectedCompressed);

        const uncompressed = uncompress(compressed, maxLength);
        const expectedUncompressed = snappyJsUncompress(compressed);
        expect(uncompressed).toEqual(expectedUncompressed);
      }
    });
  }
});
