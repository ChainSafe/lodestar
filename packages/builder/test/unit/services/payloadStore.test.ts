import {describe, expect, it} from "vitest";
import {PayloadStore} from "../../../src/services/payloadStore.js";
import {mockBuiltPayload} from "../utils/payload.js";

describe("PayloadStore", () => {
  const blockHash = "0x" + "cc".repeat(32);

  it("returns no payload for an unknown hash and can prune an empty store", () => {
    const store = new PayloadStore();

    expect(store.get(blockHash)).toBeNull();
    expect(store.has(blockHash)).toBe(false);
    store.prune(8);
    expect(store.size).toBe(0);
  });

  it("stores and prunes payloads by slot", () => {
    const store = new PayloadStore();
    store.add({slot: 5, parentBlockRoot: Buffer.alloc(32), blockHash, payload: mockBuiltPayload()});
    expect(store.has(blockHash)).toBe(true);
    expect(store.get(blockHash)?.slot).toEqual(5);
    store.prune(7);
    expect(store.has(blockHash)).toBe(true);
    store.prune(8);
    expect(store.has(blockHash)).toBe(false);
    expect(store.get(blockHash)).toBeNull();
  });

  it("does not increase the size when the same payload is added twice", () => {
    const store = new PayloadStore();
    const stored = {slot: 5, parentBlockRoot: Buffer.alloc(32), blockHash, payload: mockBuiltPayload({slot: 5})};

    store.add(stored);
    store.add(stored);

    expect(store.size).toBe(1);
    expect(store.get(blockHash)).toEqual(stored);
  });

  it("prunes expired payloads regardless of insertion order and keeps all retained hashes", () => {
    const store = new PayloadStore();
    const records = [8, 5, 6, 8].map((slot, index) => {
      const hash = Buffer.alloc(32, index + 1);
      return {
        slot,
        parentBlockRoot: Buffer.alloc(32, index + 5),
        blockHash: "0x" + hash.toString("hex"),
        payload: mockBuiltPayload({slot, blockHash: hash}),
      };
    });
    for (const record of records) store.add(record);
    expect(store.size).toBe(4);

    store.prune(8);
    store.prune(8);
    expect(store.size).toBe(3);
    for (const record of records) {
      const retained = record.slot >= 6;
      expect(store.has(record.blockHash), `membership for slot ${record.slot}`).toBe(retained);
      expect(store.get(record.blockHash), `payload for hash ${record.blockHash}`).toEqual(retained ? record : null);
    }

    store.prune(9);
    expect(store.size).toBe(2);
    expect(store.has(records[2].blockHash)).toBe(false);
    for (const record of [records[0], records[3]]) {
      expect(store.get(record.blockHash), `retained slot-8 hash ${record.blockHash}`).toEqual(record);
    }

    store.prune(11);
    expect(store.size).toBe(0);
    for (const record of records) {
      expect(store.get(record.blockHash), `expired hash ${record.blockHash}`).toBeNull();
    }
  });
});
