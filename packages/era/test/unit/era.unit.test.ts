import {assert, describe, it} from "vitest";
import {E2STORE_HEADER_SIZE, E2StoreEntryType, EraTypes, readEntry} from "../../src/index.js";

function header(typeBytes: Uint8Array, dataLen: number): Uint8Array {
  const h = new Uint8Array(8);
  h[0] = typeBytes[0];
  h[1] = typeBytes[1];
  // 4-byte LE length
  h[2] = dataLen & 0xff;
  h[3] = (dataLen >> 8) & 0xff;
  h[4] = (dataLen >> 16) & 0xff;
  h[5] = (dataLen >> 24) & 0xff;
  // reserved = 0x0000
  h[6] = 0x00;
  h[7] = 0x00;
  return h;
}

describe("e2Store utilities (unit)", () => {
  it("should read the type and data correctly", () => {
    const payload = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
    const bytes = new Uint8Array([...header(EraTypes[E2StoreEntryType.Version], payload.length), ...payload]);

    const entry = readEntry(bytes);
    assert.equal(entry.type, E2StoreEntryType.Version);
    assert.deepEqual(entry.data, payload);
  });

  it("should throw on entry with invalid length", () => {
    const bad = new Uint8Array([...header(EraTypes[E2StoreEntryType.Version], 25), 0x01, 0x02, 0x03, 0x04]);

    try {
      readEntry(bad);
      assert.fail("should have thrown on invalid data length");
    } catch (err) {
      assert.instanceOf(err, Error);
    }
  });

  it("should iterate and read multiple entries ", () => {
    const firstPayload = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
    const first = new Uint8Array([...header(EraTypes[E2StoreEntryType.Version], firstPayload.length), ...firstPayload]);
    const second = header(EraTypes[E2StoreEntryType.Empty], 0);
    const bytes = new Uint8Array([...first, ...second]);

    const entries: Array<ReturnType<typeof readEntry>> = [];
    let p = 0;
    while (p + E2STORE_HEADER_SIZE <= bytes.length) {
      const e = readEntry(bytes.slice(p));
      entries.push(e);
      p += E2STORE_HEADER_SIZE + e.data.length;
    }

    assert.equal(entries.length, 2);
    assert.equal(entries[0].type, E2StoreEntryType.Version);
    assert.equal(entries[1].type, E2StoreEntryType.Empty);
  });
});
