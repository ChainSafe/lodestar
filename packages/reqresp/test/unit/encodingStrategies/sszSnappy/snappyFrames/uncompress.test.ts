import {describe, it, expect} from "vitest";
import {Uint8ArrayList} from "uint8arraylist";
import {pipe} from "it-pipe";
import {SnappyFramesUncompress} from "../../../../../src/encodingStrategies/sszSnappy/snappyFrames/uncompress.js";
import {encodeSnappy} from "../../../../../src/encodingStrategies/sszSnappy/snappyFrames/compress.js";

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
});
