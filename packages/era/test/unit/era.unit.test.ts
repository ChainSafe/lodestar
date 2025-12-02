import {assert, describe, it} from "vitest";
import {E2STORE_HEADER_SIZE, EntryType, parseEntryHeader} from "../../src/e2s.ts";

function header(type: EntryType, dataLen: number): Uint8Array {
  const h = new Uint8Array(8);
  h[0] = type;
  h[1] = type >> 8;
  // 4-byte LE length
  h[2] = dataLen & 0xff;
  h[3] = (dataLen >> 8) & 0xff;
  h[4] = (dataLen >> 16) & 0xff;
  h[5] = (dataLen >> 24) & 0xff;
  // reserved = 0x0000
  // h[6] = 0x00;
  // h[7] = 0x00;
  return h;
}

describe("e2Store utilities (unit)", () => {
  it("should read the type and data correctly", () => {
    const payload = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
    const ver = header(EntryType.Version, 0);
    const bytes = new Uint8Array([...ver, ...header(EntryType.Empty, payload.length), ...payload]);

    // Read the second entry (Empty with payload)
    const entry = parseEntryHeader(bytes.slice(E2STORE_HEADER_SIZE));
    assert.equal(entry.type, EntryType.Empty);
    assert.deepEqual(entry.length, payload.length);
  });

  it("should iterate and read multiple entries ", () => {
    const firstPayload = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
    const ver = header(EntryType.Version, 0);
    const first = new Uint8Array([...header(EntryType.Empty, firstPayload.length), ...firstPayload]);
    const second = header(EntryType.Empty, 0);
    const bytes = new Uint8Array([...ver, ...first, ...second]);

    const entries: Array<ReturnType<typeof parseEntryHeader>> = [];
    let p = 0;
    while (p + E2STORE_HEADER_SIZE <= bytes.length) {
      const e = parseEntryHeader(bytes.slice(p));
      entries.push(e);
      p += E2STORE_HEADER_SIZE + e.length;
    }

    assert.equal(entries.length, 3);
    assert.equal(entries[0].type, EntryType.Version);
    assert.equal(entries[0].length, 0);
    assert.equal(entries[1].type, EntryType.Empty);
    assert.equal(entries[2].type, EntryType.Empty);
  });
});
