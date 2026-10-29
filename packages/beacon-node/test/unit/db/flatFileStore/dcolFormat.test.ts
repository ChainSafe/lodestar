import {describe, expect, it} from "vitest";
import {
  DCOL_HEADER_SIZE,
  DCOL_VERSION,
  encodeDcolFile,
  encodeDcolHeader,
  getBit,
  mergeDcolColumns,
  parseDcolHeader,
  popcount,
  readAllColumns,
  readColumn,
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
        bitmap,
        blockRoot,
        slot: 1234567,
      };

      const encoded = encodeDcolHeader(original);
      expect(encoded.length).toBe(DCOL_HEADER_SIZE);

      const decoded = parseDcolHeader(encoded);
      expect(decoded.version).toBe(DCOL_VERSION);
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

    it("should handle max 4-byte slot value", () => {
      const original = {
        version: DCOL_VERSION,
        bitmap: new Uint8Array(16),
        blockRoot: new Uint8Array(32),
        slot: 0xffffffff, // max uint32, ~1634 years after genesis
      };

      const encoded = encodeDcolHeader(original);
      const decoded = parseDcolHeader(encoded);
      expect(decoded.slot).toBe(0xffffffff);
    });

    it.each([-1, 1.5, 0x100000000])("should defensively reject invalid slot %s", (slot) => {
      expect(() =>
        encodeDcolHeader({
          version: DCOL_VERSION,
          bitmap: new Uint8Array(16),
          blockRoot: new Uint8Array(32),
          slot,
        })
      ).toThrow("Invalid dcol slot");
    });

    it.each([31, 33])("should defensively reject a %s-byte block root", (length) => {
      expect(() =>
        encodeDcolHeader({
          version: DCOL_VERSION,
          bitmap: new Uint8Array(16),
          blockRoot: new Uint8Array(length),
          slot: 0,
        })
      ).toThrow("Invalid dcol block root length");
    });

    it.each([15, 17])("should defensively reject a %s-byte bitmap", (length) => {
      expect(() =>
        encodeDcolHeader({
          version: DCOL_VERSION,
          bitmap: new Uint8Array(length),
          blockRoot: new Uint8Array(32),
          slot: 0,
        })
      ).toThrow("Invalid dcol bitmap length");
    });

    it("should reject slot exceeding 4-byte range", () => {
      const header = encodeDcolHeader({
        version: DCOL_VERSION,
        bitmap: new Uint8Array(16),
        blockRoot: new Uint8Array(32),
        slot: 0,
      });
      // Manually set a non-zero high byte in the slot field (slot starts at byte 53)
      header[53 + 4] = 1;
      expect(() => parseDcolHeader(header)).toThrow("dcol slot exceeds 4-byte range");
    });
  });

  describe("encodeDcolFile", () => {
    it("should encode and decode a file with multiple columns", () => {
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

      const header = parseDcolHeader(encoded);
      expect(header.version).toBe(DCOL_VERSION);
      expect(header.slot).toBe(42);
      expect(totalBits(header.bitmap)).toBe(3);
      expect(getBit(header.bitmap, 0)).toBe(true);
      expect(getBit(header.bitmap, 5)).toBe(true);
      expect(getBit(header.bitmap, 127)).toBe(true);

      // Verify column data via readColumn
      expect(readColumn(encoded, header, 0)).toEqual(col0);
      expect(readColumn(encoded, header, 5)).toEqual(col5);
      expect(readColumn(encoded, header, 127)).toEqual(col127);
      expect(readColumn(encoded, header, 1)).toBeNull();
    });

    it("should round-trip columns with varying content", () => {
      const blockRoot = new Uint8Array(32).fill(0xdd);
      const columns = [];
      for (let i = 0; i < 8; i++) {
        const data = new Uint8Array(200);
        for (let j = 0; j < 200; j++) data[j] = (i * 37 + j) & 0xff;
        columns.push({index: i * 16, data});
      }

      const encoded = encodeDcolFile(blockRoot, 999, columns);
      const header = parseDcolHeader(encoded);

      for (const col of columns) {
        const result = readColumn(encoded, header, col.index);
        expect(result).toEqual(col.data);
      }
    });

    it("should throw on empty columns", () => {
      expect(() => encodeDcolFile(new Uint8Array(32), 0, [])).toThrow("zero columns");
    });

    it.each([-1, 1.5, 128])("should defensively reject invalid column index %s", (index) => {
      expect(() => encodeDcolFile(new Uint8Array(32), 0, [{index, data: new Uint8Array(1)}])).toThrow(
        "Invalid dcol column index"
      );
    });

    it("should defensively reject duplicate column indices", () => {
      expect(() =>
        encodeDcolFile(new Uint8Array(32), 0, [
          {index: 3, data: new Uint8Array([1])},
          {index: 3, data: new Uint8Array([2])},
        ])
      ).toThrow("Duplicate dcol column index");
    });

    it("compressed file should be smaller than uncompressed size for uniform data", () => {
      const blockRoot = new Uint8Array(32);
      const col = new Uint8Array(13000).fill(0x42);
      const encoded = encodeDcolFile(blockRoot, 1, [{index: 0, data: col}]);
      // Snappy should compress uniform data well
      expect(encoded.length).toBeLessThan(DCOL_HEADER_SIZE + 13000);
    });
  });

  describe("readColumn / readAllColumns", () => {
    it("readAllColumns should return all columns in order", () => {
      const blockRoot = new Uint8Array(32).fill(0xee);
      const col3 = new Uint8Array(80).fill(0x03);
      const col10 = new Uint8Array(80).fill(0x0a);
      const col50 = new Uint8Array(80).fill(0x32);

      const encoded = encodeDcolFile(blockRoot, 100, [
        {index: 50, data: col50},
        {index: 3, data: col3},
        {index: 10, data: col10},
      ]);

      const header = parseDcolHeader(encoded);
      const all = readAllColumns(encoded, header);

      expect(all.length).toBe(3);
      expect(all[0].index).toBe(3);
      expect(all[0].data).toEqual(col3);
      expect(all[1].index).toBe(10);
      expect(all[1].data).toEqual(col10);
      expect(all[2].index).toBe(50);
      expect(all[2].data).toEqual(col50);
    });

    it("readColumn on absent index returns null", () => {
      const encoded = encodeDcolFile(new Uint8Array(32), 1, [{index: 5, data: new Uint8Array(50).fill(0xab)}]);
      const header = parseDcolHeader(encoded);
      expect(readColumn(encoded, header, 0)).toBeNull();
      expect(readColumn(encoded, header, 6)).toBeNull();
    });

    it("should reject a terminal offset beyond the data region", () => {
      const encoded = encodeDcolFile(new Uint8Array(32), 1, [{index: 0, data: new Uint8Array(50).fill(0xab)}]);
      new DataView(encoded.buffer, encoded.byteOffset, encoded.byteLength).setUint32(
        DCOL_HEADER_SIZE + 4,
        1_000_000,
        false
      );

      expect(() => readAllColumns(encoded, parseDcolHeader(encoded))).toThrow("Invalid dcol offset table");
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
      expect(header.version).toBe(DCOL_VERSION);
      expect(totalBits(header.bitmap)).toBe(2);
      expect(getBit(header.bitmap, 0)).toBe(true);
      expect(getBit(header.bitmap, 5)).toBe(true);

      expect(readColumn(merged, header, 0)).toEqual(col0);
      expect(readColumn(merged, header, 5)).toEqual(col5);
    });

    it("should overwrite existing column", () => {
      const blockRoot = new Uint8Array(32).fill(0xcc);
      const colOld = new Uint8Array(30).fill(0x01);
      const colNew = new Uint8Array(30).fill(0xff);

      const existing = encodeDcolFile(blockRoot, 200, [{index: 3, data: colOld}]);
      const merged = mergeDcolColumns(existing, [{index: 3, data: colNew}]);

      const header = parseDcolHeader(merged);
      expect(totalBits(header.bitmap)).toBe(1);
      expect(readColumn(merged, header, 3)).toEqual(colNew);
    });

    it("should defensively reject duplicate indices within a merge batch", () => {
      const existing = encodeDcolFile(new Uint8Array(32), 200, [{index: 0, data: new Uint8Array([1])}]);

      expect(() =>
        mergeDcolColumns(existing, [
          {index: 3, data: new Uint8Array([2])},
          {index: 3, data: new Uint8Array([3])},
        ])
      ).toThrow("Duplicate dcol column index");
    });

    it("should reject malformed existing offsets", () => {
      const existing = encodeDcolFile(new Uint8Array(32), 200, [{index: 0, data: new Uint8Array([1])}]);
      new DataView(existing.buffer, existing.byteOffset, existing.byteLength).setUint32(
        DCOL_HEADER_SIZE + 4,
        1_000_000,
        false
      );

      expect(() => mergeDcolColumns(existing, [{index: 1, data: new Uint8Array([2])}])).toThrow(
        "Invalid dcol offset table"
      );
    });
  });
});
