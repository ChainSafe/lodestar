import {describe, expect, it} from "vitest";
import {
  DCOL_HEADER_SIZE,
  DCOL_VERSION,
  encodeDcolFile,
  encodeDcolHeader,
  getBit,
  getColumnOffset,
  mergeDcolColumns,
  parseDcolHeader,
  popcount,
  setBit,
  totalBits,
} from "../../../../src/db/flatFileStore/dcolFormat.js";

describe("dcolFormat", () => {
  describe("bitmap helpers", () => {
    it("should set and get bits correctly", () => {
      const bitmap = new Uint8Array(16);

      setBit(bitmap, 0);
      setBit(bitmap, 7);
      setBit(bitmap, 8);
      setBit(bitmap, 127);

      expect(getBit(bitmap, 0)).toBe(true);
      expect(getBit(bitmap, 1)).toBe(false);
      expect(getBit(bitmap, 7)).toBe(true);
      expect(getBit(bitmap, 8)).toBe(true);
      expect(getBit(bitmap, 9)).toBe(false);
      expect(getBit(bitmap, 127)).toBe(true);
    });

    it("popcount should count bits below index", () => {
      const bitmap = new Uint8Array(16);
      setBit(bitmap, 0);
      setBit(bitmap, 3);
      setBit(bitmap, 7);

      expect(popcount(bitmap, 0)).toBe(0);
      expect(popcount(bitmap, 1)).toBe(1); // bit 0
      expect(popcount(bitmap, 4)).toBe(2); // bits 0, 3
      expect(popcount(bitmap, 8)).toBe(3); // bits 0, 3, 7
    });

    it("totalBits should count all set bits", () => {
      const bitmap = new Uint8Array(16);
      expect(totalBits(bitmap)).toBe(0);

      setBit(bitmap, 0);
      setBit(bitmap, 64);
      setBit(bitmap, 127);
      expect(totalBits(bitmap)).toBe(3);
    });
  });

  describe("header encode/decode", () => {
    it("should round-trip a header", () => {
      const blockRoot = new Uint8Array(32);
      blockRoot[0] = 0xab;
      blockRoot[31] = 0xcd;

      const bitmap = new Uint8Array(16);
      setBit(bitmap, 5);
      setBit(bitmap, 100);

      const original = {
        version: DCOL_VERSION,
        columnSize: 131072,
        bitmap,
        blockRoot,
        slot: 1234567,
      };

      const encoded = encodeDcolHeader(original);
      expect(encoded.length).toBe(DCOL_HEADER_SIZE);

      const decoded = parseDcolHeader(encoded);
      expect(decoded.version).toBe(DCOL_VERSION);
      expect(decoded.columnSize).toBe(131072);
      expect(decoded.slot).toBe(1234567);
      expect(decoded.blockRoot[0]).toBe(0xab);
      expect(decoded.blockRoot[31]).toBe(0xcd);
      expect(getBit(decoded.bitmap, 5)).toBe(true);
      expect(getBit(decoded.bitmap, 100)).toBe(true);
      expect(getBit(decoded.bitmap, 6)).toBe(false);
    });

    it("should reject too-small data", () => {
      expect(() => parseDcolHeader(new Uint8Array(10))).toThrow("too small");
    });

    it("should reject wrong version", () => {
      const data = new Uint8Array(DCOL_HEADER_SIZE);
      data[0] = 0xff;
      expect(() => parseDcolHeader(data)).toThrow("Unsupported dcol version");
    });

    it("should handle large slot values", () => {
      const original = {
        version: DCOL_VERSION,
        columnSize: 100,
        bitmap: new Uint8Array(16),
        blockRoot: new Uint8Array(32),
        slot: 9007199254740991, // Number.MAX_SAFE_INTEGER
      };

      const encoded = encodeDcolHeader(original);
      const decoded = parseDcolHeader(encoded);
      expect(decoded.slot).toBe(9007199254740991);
    });
  });

  describe("getColumnOffset", () => {
    it("should return -1 for absent column", () => {
      const bitmap = new Uint8Array(16);
      setBit(bitmap, 0);
      expect(getColumnOffset(bitmap, 100, 1)).toBe(-1);
    });

    it("should calculate offset correctly", () => {
      const bitmap = new Uint8Array(16);
      setBit(bitmap, 0);
      setBit(bitmap, 3);
      setBit(bitmap, 5);

      const columnSize = 200;
      // Column 0: offset = HEADER + 0 * 200
      expect(getColumnOffset(bitmap, columnSize, 0)).toBe(DCOL_HEADER_SIZE);
      // Column 3: offset = HEADER + 1 * 200 (bit 0 before it)
      expect(getColumnOffset(bitmap, columnSize, 3)).toBe(DCOL_HEADER_SIZE + 200);
      // Column 5: offset = HEADER + 2 * 200 (bits 0, 3 before it)
      expect(getColumnOffset(bitmap, columnSize, 5)).toBe(DCOL_HEADER_SIZE + 400);
    });
  });

  describe("encodeDcolFile", () => {
    it("should encode and parse a file with multiple columns", () => {
      const blockRoot = new Uint8Array(32).fill(0xaa);
      const slot = 42;
      const col0 = new Uint8Array(100).fill(0x01);
      const col5 = new Uint8Array(100).fill(0x05);
      const col127 = new Uint8Array(100).fill(0x7f);

      const encoded = encodeDcolFile(blockRoot, slot, [
        {index: 5, data: col5},
        {index: 0, data: col0},
        {index: 127, data: col127},
      ]);

      expect(encoded.length).toBe(DCOL_HEADER_SIZE + 3 * 100);

      const header = parseDcolHeader(encoded);
      expect(header.slot).toBe(42);
      expect(header.columnSize).toBe(100);
      expect(totalBits(header.bitmap)).toBe(3);
      expect(getBit(header.bitmap, 0)).toBe(true);
      expect(getBit(header.bitmap, 5)).toBe(true);
      expect(getBit(header.bitmap, 127)).toBe(true);

      // Verify column data via offset
      const off0 = getColumnOffset(header.bitmap, header.columnSize, 0);
      expect(encoded.slice(off0, off0 + 100)).toEqual(col0);

      const off5 = getColumnOffset(header.bitmap, header.columnSize, 5);
      expect(encoded.slice(off5, off5 + 100)).toEqual(col5);

      const off127 = getColumnOffset(header.bitmap, header.columnSize, 127);
      expect(encoded.slice(off127, off127 + 100)).toEqual(col127);
    });

    it("should throw on empty columns", () => {
      expect(() => encodeDcolFile(new Uint8Array(32), 0, [])).toThrow("zero columns");
    });

    it("should throw on mismatched column sizes", () => {
      expect(() =>
        encodeDcolFile(new Uint8Array(32), 0, [
          {index: 0, data: new Uint8Array(100)},
          {index: 1, data: new Uint8Array(200)},
        ])
      ).toThrow("size mismatch");
    });
  });

  describe("mergeDcolColumns", () => {
    it("should merge new columns into existing file", () => {
      const blockRoot = new Uint8Array(32).fill(0xbb);
      const col0 = new Uint8Array(50).fill(0x01);
      const col5 = new Uint8Array(50).fill(0x05);

      const existing = encodeDcolFile(blockRoot, 100, [{index: 0, data: col0}]);

      const merged = mergeDcolColumns(existing, [{index: 5, data: col5}]);

      const header = parseDcolHeader(merged);
      expect(totalBits(header.bitmap)).toBe(2);
      expect(getBit(header.bitmap, 0)).toBe(true);
      expect(getBit(header.bitmap, 5)).toBe(true);
      expect(header.columnSize).toBe(50);

      // Verify both columns
      const off0 = getColumnOffset(header.bitmap, header.columnSize, 0);
      expect(merged.slice(off0, off0 + 50)).toEqual(col0);

      const off5 = getColumnOffset(header.bitmap, header.columnSize, 5);
      expect(merged.slice(off5, off5 + 50)).toEqual(col5);
    });

    it("should overwrite existing column", () => {
      const blockRoot = new Uint8Array(32).fill(0xcc);
      const colOld = new Uint8Array(30).fill(0x01);
      const colNew = new Uint8Array(30).fill(0xff);

      const existing = encodeDcolFile(blockRoot, 200, [{index: 3, data: colOld}]);
      const merged = mergeDcolColumns(existing, [{index: 3, data: colNew}]);

      const header = parseDcolHeader(merged);
      expect(totalBits(header.bitmap)).toBe(1);

      const off = getColumnOffset(header.bitmap, header.columnSize, 3);
      expect(merged.slice(off, off + 30)).toEqual(colNew);
    });
  });
});
