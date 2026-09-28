import * as snappy from "snappy";
import {Uint8ArrayList} from "uint8arraylist";
import {describe, expect, it} from "vitest";
import {
  ChunkType,
  IDENTIFIER_FRAME,
  UNCOMPRESSED_CHUNK_SIZE,
  crc,
  decodeSnappyFrameData,
  decodeSnappyFrames,
  encodeSnappy,
  parseSnappyFrameHeader,
} from "../../../../../src/utils/snappyIndex.js";

describe("encodingStrategies / sszSnappy / snappy frames / uncompress", () => {
  const malformedBlocks = [
    {name: "missing output", raw: "08", decoded: "0000000000000000"},
    {name: "underfilled output", raw: "080041", decoded: "4100000000000000"},
    {name: "overfilled literal", raw: "01044142", decoded: "41"},
    {name: "truncated one-byte copy", raw: "01004101", decoded: "41"},
    {name: "overfilled one-byte copy", raw: "0100410101", decoded: "41"},
    {name: "overfilled two-byte copy", raw: "010041020100", decoded: "41"},
    {name: "overfilled four-byte copy", raw: "0100410301000000", decoded: "41"},
    {name: "out-of-range unsigned copy offset", raw: "02004103ffffffff", decoded: "4100"},
    {name: "out-of-range unsigned literal length", raw: "01fc00000080", decoded: "00"},
    {name: "maximum unsigned literal length", raw: "00fcffffffff", decoded: ""},
    {name: "backward-position literal", raw: "00fcfaffffff", decoded: ""},
  ];

  for (const {name, raw, decoded} of malformedBlocks) {
    for (const buffer of [false, true]) {
      it(`rejects ${name} with a matching checksum (${buffer ? "Buffer" : "Uint8Array"})`, () => {
        const frame = Buffer.concat([crc(Buffer.from(decoded, "hex")), Buffer.from(raw, "hex")]);
        expect(() => decodeSnappyFrameData(ChunkType.COMPRESSED, buffer ? frame : new Uint8Array(frame))).toThrow(
          /^snappy: /
        );
      });
    }
  }

  it.each([
    {name: "empty output", raw: "00", decoded: ""},
    {name: "literal", raw: "010041", decoded: "41"},
    {name: "overlapping one-byte copy", raw: "0500410101", decoded: "4141414141"},
    {name: "overlapping two-byte copy", raw: "0500410e0100", decoded: "4141414141"},
    {name: "overlapping four-byte copy", raw: "0500410f01000000", decoded: "4141414141"},
    {name: "separate literals", raw: "0200410042", decoded: "4142"},
  ])("accepts valid $name", ({raw, decoded}) => {
    const expected = Buffer.from(decoded, "hex");
    const frame = Buffer.concat([crc(expected), Buffer.from(raw, "hex")]);
    for (const input of [frame, new Uint8Array(frame)]) {
      expect(Buffer.from(decodeSnappyFrameData(ChunkType.COMPRESSED, input) ?? []), `${raw}: decoded output`).toEqual(
        expected
      );
    }
  });

  it.each([0, 1, 127, 128, 16383, 16384, 65535, UNCOMPRESSED_CHUNK_SIZE])(
    "accepts a compressed frame declaring %i bytes",
    (length) => {
      const expected = Buffer.alloc(length, 0x61);
      const frame = Buffer.concat([crc(expected), snappy.compressSync(expected)]);
      expect(Buffer.from(decodeSnappyFrameData(ChunkType.COMPRESSED, new Uint8Array(frame)) ?? [])).toEqual(expected);
    }
  );

  it.each(["818004", "ffffffff0f"])("rejects oversized declared output %s", (raw) => {
    const frame = Buffer.concat([Buffer.alloc(4), Buffer.from(raw, "hex")]);
    expect(() => decodeSnappyFrameData(ChunkType.COMPRESSED, frame)).toThrow(/large/);
  });

  it.each(["", "80", "80808080", "8080808080", "808080808000", "818080808080808080000041", "ffffffff10", "ffffffff7f"])(
    "rejects malformed length %s",
    (raw) => {
      const frame = Buffer.concat([Buffer.alloc(4), Buffer.from(raw, "hex")]);
      for (const input of [frame, new Uint8Array(frame)]) {
        expect(() => decodeSnappyFrameData(ChunkType.COMPRESSED, input), input.constructor.name).toThrow(/^snappy: /);
      }
    }
  );

  it.each(["010041", "81000041", "8180000041", "818080000041", "81808080000041"])(
    "accepts valid length prefix in %s",
    (raw) => {
      const expected = Buffer.from("A");
      const frame = Buffer.concat([crc(expected), Buffer.from(raw, "hex")]);
      expect(Buffer.from(decodeSnappyFrameData(ChunkType.COMPRESSED, frame) ?? [])).toEqual(expected);
    }
  );

  it.each([false, true])("preserves input views and independent output (Buffer: %s)", (buffer) => {
    const expected = Buffer.alloc(1024, 0x61);
    const frame = Buffer.concat([crc(expected), snappy.compressSync(expected)]);
    const guarded = Buffer.alloc(frame.length + 32, 0xab);
    guarded.set(frame, 13);
    const before = Buffer.from(guarded);
    const input = buffer
      ? guarded.subarray(13, 13 + frame.length)
      : new Uint8Array(guarded.buffer, guarded.byteOffset + 13, frame.length);
    const decoded = decodeSnappyFrameData(ChunkType.COMPRESSED, input);
    expect(Buffer.from(decoded ?? [])).toEqual(expected);
    expect(Buffer.isBuffer(decoded)).toBe(buffer);
    expect(guarded).toEqual(before);

    guarded.fill(0);
    const next = Buffer.from("different payload");
    decodeSnappyFrameData(ChunkType.COMPRESSED, Buffer.concat([crc(next), snappy.compressSync(next)]));
    expect(Buffer.from(decoded ?? [])).toEqual(expected);
  });

  it("rejects an invalid checksum on a valid compressed frame", () => {
    const expected = Buffer.alloc(1024, 0x61);
    const checksum = crc(expected);
    checksum[0] ^= 0xff;
    const frame = Buffer.concat([checksum, snappy.compressSync(expected)]);
    expect(() => decodeSnappyFrameData(ChunkType.COMPRESSED, frame)).toThrow(/bad checksum/);
  });

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
