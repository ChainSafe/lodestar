import {pipe} from "it-pipe";
import {Uint8ArrayList} from "uint8arraylist";
import {describe, expect, it} from "vitest";
import {ChunkType, IDENTIFIER_FRAME, crc} from "../../../../../src/encodingStrategies/sszSnappy/snappyFrames/common.js";
import {encodeSnappy} from "../../../../../src/encodingStrategies/sszSnappy/snappyFrames/compress.js";
import {SnappyFramesUncompress} from "../../../../../src/encodingStrategies/sszSnappy/snappyFrames/uncompress.js";

describe("encodingStrategies / sszSnappy / snappy frames / uncompress", () => {
  it("should work with short input", () =>
    new Promise<void>((done) => {
      const testData = "Small test data";
      const compressIterable = encodeSnappy(Buffer.from(testData));

      const decompress = new SnappyFramesUncompress();

      void pipe(compressIterable, async (source) => {
        for await (const data of source) {
          const result = decompress.uncompress(new Uint8ArrayList(data));
          if (result) {
            expect(result.subarray().toString()).toBe(testData);
            done();
          }
        }
      });
    }));

  it("should work with huge input", () =>
    new Promise<void>((done) => {
      const testData = Buffer.alloc(100000, 4).toString();
      const compressIterable = encodeSnappy(Buffer.from(testData));
      let result = Buffer.alloc(0);
      const decompress = new SnappyFramesUncompress();

      void pipe(compressIterable, async (source) => {
        for await (const data of source) {
          // testData will come compressed as two or more chunks
          result = Buffer.concat([
            result,
            decompress.uncompress(new Uint8ArrayList(data))?.subarray() ?? Buffer.alloc(0),
          ]);
          if (result.length === testData.length) {
            expect(result.toString()).toBe(testData);
            done();
          }
        }
      });
    }));

  it("should detect malformed input", () => {
    const decompress = new SnappyFramesUncompress();

    expect(() => decompress.uncompress(new Uint8ArrayList(Buffer.alloc(32, 5)))).toThrow();
  });

  it("should return null if not enough data", () => {
    const decompress = new SnappyFramesUncompress();

    expect(decompress.uncompress(new Uint8ArrayList(Buffer.alloc(3, 1)))).toBe(null);
  });

  it("should detect invalid checksum", () => {
    const chunks = new Uint8ArrayList();
    chunks.append(IDENTIFIER_FRAME);

    chunks.append(Uint8Array.from([ChunkType.UNCOMPRESSED, 0x80, 0x00, 0x00]));
    // first 4 bytes are checksum
    // 0xffffffff is clearly an invalid checksum
    chunks.append(Uint8Array.from(Array.from({length: 0x80}, () => 0xff)));

    const decompress = new SnappyFramesUncompress();
    expect(() => decompress.uncompress(chunks)).toThrow(/checksum/);
  });

  it("should detect skippable frames", () => {
    const chunks = new Uint8ArrayList();
    chunks.append(IDENTIFIER_FRAME);

    chunks.append(Uint8Array.from([ChunkType.SKIPPABLE, 0x80, 0x00, 0x00]));
    chunks.append(Uint8Array.from(Array.from({length: 0x80}, () => 0xff)));

    const decompress = new SnappyFramesUncompress();
    expect(decompress.uncompress(chunks)).toBeNull();
  });

  it("should detect large data", () => {
    const chunks = new Uint8ArrayList();
    chunks.append(IDENTIFIER_FRAME);

    // add a chunk of size 100000
    chunks.append(Uint8Array.from([ChunkType.UNCOMPRESSED, 160, 134, 1]));
    const data = Uint8Array.from(Array.from({length: 100000 - 4}, () => 0xff));
    const checksum = crc(data);
    chunks.append(checksum);
    chunks.append(data);

    const decompress = new SnappyFramesUncompress();
    expect(() => decompress.uncompress(chunks)).toThrow(/large/);
  });
});
