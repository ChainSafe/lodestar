import {Uint8ArrayList} from "uint8arraylist";
import {describe, expect, it} from "vitest";
import {
  ChunkType,
  IDENTIFIER_FRAME,
  SnappyFramesUncompress,
  crc,
  encodeSnappyFrames,
} from "../../../../../src/utils/snappyIndex.js";

describe("encodingStrategies / sszSnappy / snappy frames / uncompress", () => {
  it("should work with short input", () => {
    const testData = "Small test data";
    const compressed = encodeSnappyFrames(Buffer.from(testData));
    const decompress = new SnappyFramesUncompress();

    const result = decompress.uncompress(compressed);
    expect(result).not.toBeNull();
    expect(Buffer.from(result?.subarray() ?? []).toString()).toBe(testData);
  });

  it("should work with huge input", () => {
    const testData = Buffer.alloc(100000, 4).toString();
    const compressed = encodeSnappyFrames(Buffer.from(testData));
    const decompress = new SnappyFramesUncompress();

    const result = decompress.uncompress(compressed);
    expect(result).not.toBeNull();
    expect(Buffer.from(result?.subarray() ?? []).toString()).toBe(testData);
  });

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
    // IDENTIFIER_FRAME is a Buffer, convert to Uint8Array
    chunks.append(Uint8Array.from(IDENTIFIER_FRAME));

    chunks.append(Uint8Array.from([ChunkType.UNCOMPRESSED, 0x80, 0x00, 0x00]));
    // first 4 bytes are checksum
    // 0xffffffff is clearly an invalid checksum
    chunks.append(Uint8Array.from(Array.from({length: 0x80}, () => 0xff)));

    const decompress = new SnappyFramesUncompress();
    expect(() => decompress.uncompress(chunks)).toThrow(/checksum/);
  });

  it("should detect skippable frames", () => {
    const chunks = new Uint8ArrayList();
    chunks.append(Uint8Array.from(IDENTIFIER_FRAME));

    chunks.append(Uint8Array.from([ChunkType.SKIPPABLE, 0x80, 0x00, 0x00]));
    chunks.append(Uint8Array.from(Array.from({length: 0x80}, () => 0xff)));

    const decompress = new SnappyFramesUncompress();
    expect(decompress.uncompress(chunks)).toBeNull();
  });

  it("should detect large data", () => {
    const chunks = new Uint8ArrayList();
    chunks.append(Uint8Array.from(IDENTIFIER_FRAME));

    // add a chunk of size 100000
    chunks.append(Uint8Array.from([ChunkType.UNCOMPRESSED, 160, 134, 1]));
    const data = Uint8Array.from(Array.from({length: 100000 - 4}, () => 0xff));
    const checksum = crc(data);
    chunks.append(Uint8Array.from(checksum));
    chunks.append(data);

    const decompress = new SnappyFramesUncompress();
    expect(() => decompress.uncompress(chunks)).toThrow(/large/);
  });
});
