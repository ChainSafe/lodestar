import {Uint8ArrayList} from "uint8arraylist";
import {describe, expect, it} from "vitest";
import {
  ChunkType,
  IDENTIFIER_FRAME,
  crc,
  decodeSnappyFrameData,
  decodeSnappyFrames,
  encodeSnappy,
  parseSnappyFrameHeader,
} from "../../../../../src/utils/snappyIndex.js";

describe("encodingStrategies / sszSnappy / snappy frames / uncompress", () => {
  it("should work with short input", async () => {
    const testData = "Small test data";
    const compressIterable = encodeSnappy(Buffer.from(testData));
    const encoded: Uint8Array[] = [];

    for await (const data of compressIterable) {
      encoded.push(data);
    }

    const result = decodeSnappyFrames(Buffer.concat(encoded));
    expect(Buffer.from(result.subarray()).toString()).toBe(testData);
  });

  it("should work with huge input", async () => {
    const testData = Buffer.alloc(100000, 4).toString();
    const compressIterable = encodeSnappy(Buffer.from(testData));
    const encoded: Uint8Array[] = [];

    for await (const data of compressIterable) {
      encoded.push(data);
    }

    const result = decodeSnappyFrames(Buffer.concat(encoded));
    expect(Buffer.from(result.subarray()).toString()).toBe(testData);
  });

  it("should detect malformed input", () => {
    expect(() => decodeSnappyFrames(Buffer.alloc(32, 5))).toThrow();
  });

  it("should return null if not enough data", () => {
    expect(() => parseSnappyFrameHeader(Buffer.alloc(3, 1))).toThrow(/incomplete frame header/);
  });

  it("should detect invalid checksum", () => {
    const chunks = new Uint8ArrayList();
    chunks.append(IDENTIFIER_FRAME);

    chunks.append(Uint8Array.from([ChunkType.UNCOMPRESSED, 0x80, 0x00, 0x00]));
    // first 4 bytes are checksum
    // 0xffffffff is clearly an invalid checksum
    chunks.append(Uint8Array.from(Array.from({length: 0x80}, () => 0xff)));

    expect(() => decodeSnappyFrames(chunks.subarray())).toThrow(/checksum/);
  });

  it("should detect skippable frames", () => {
    const chunks = new Uint8ArrayList();
    chunks.append(IDENTIFIER_FRAME);

    chunks.append(Uint8Array.from([ChunkType.SKIPPABLE, 0x80, 0x00, 0x00]));
    chunks.append(Uint8Array.from(Array.from({length: 0x80}, () => 0xff)));

    expect(decodeSnappyFrames(chunks.subarray()).length).toBe(0);
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

    expect(() => decodeSnappyFrames(chunks.subarray())).toThrow(/large/);
  });

  it("should parse header and decode uncompressed frame", () => {
    const payload = Uint8Array.from([1, 2, 3, 4]);
    const checksum = crc(payload);
    const frame = Buffer.concat([checksum, payload]);

    const header = Uint8Array.from([ChunkType.UNCOMPRESSED, frame.length, 0x00, 0x00]);
    const parsed = parseSnappyFrameHeader(header);
    const decoded = decodeSnappyFrameData(parsed.type, frame);

    expect(parsed.frameSize).toBe(frame.length);
    expect(Buffer.from(decoded ?? [])).toEqual(Buffer.from(payload));
  });
});
