import {describe, expect, it} from "vitest";
import {SerializedList} from "@chainsafe/ssz";
import {PayloadStore} from "../../../src/services/payloadStore.js";
import {mockBuiltPayload} from "../utils/payload.js";

describe("PayloadStore", () => {
  const blockHash = "0x" + "cc".repeat(32);

  it("shares physical bytes while preserving original and current offer attribution", () => {
    const store = new PayloadStore();
    const metadata = {version: 1 as const, orderIds: [`0x${"11".repeat(32)}`], doNotOfferBefore: 0};
    const first = {
      slot: 5,
      parentBlockRoot: Buffer.alloc(32),
      blockHash,
      payload: {...mockBuiltPayload(), orderMetadata: metadata},
    };
    const old = store.add(first);
    const bytes = store.bytes;
    const next = store.add({
      ...first,
      payload: {...first.payload, orderMetadata: {...metadata, orderIds: [`0x${"22".repeat(32)}`]}},
    });
    expect(old.payload.orderMetadata?.orderIds).toEqual(metadata.orderIds);
    expect(next.payload.orderMetadata?.orderIds).toEqual([`0x${"22".repeat(32)}`]);
    expect(next.payload.executionPayload).toBe(old.payload.executionPayload);
    expect(next.payload.blobsBundle).toBe(old.payload.blobsBundle);
    expect(store.get(blockHash)).toBe(old);
    expect(store.size).toBe(1);
    expect(store.bytes).toBe(bytes);
    expect(() =>
      store.add({
        ...first,
        payload: {...first.payload, executionPayload: {...first.payload.executionPayload, gasUsed: 1}},
      })
    ).toThrow("PAYLOAD_STORE_BODY_CONFLICT");
    expect(() => store.add({...first, parentBlockRoot: Buffer.alloc(32, 1)})).toThrow("PAYLOAD_STORE_BODY_CONFLICT");
    expect(() =>
      store.add({
        ...first,
        payload: {...first.payload, orderMetadata: {...metadata, doNotOfferBefore: Date.now() + 10000}},
      })
    ).toThrow("ORDER_OFFER_TOO_EARLY");
    expect(store.get(blockHash)).toBe(old);
    expect(store.bytes).toBe(bytes);
  });

  it("reserves primary byte and count headroom without evicting alternate commitments", () => {
    const first = {slot: 5, parentBlockRoot: Buffer.alloc(32), blockHash, payload: mockBuiltPayload()};
    const measured = new PayloadStore();
    measured.add(first);
    const store = new PayloadStore(measured.bytes * 8, 4);
    store.add(first, "alternate");
    const second = {...first, blockHash: "0x" + "dd".repeat(32)};
    expect(() => store.add(second, "alternate")).toThrow();
    store.add(second);
    expect(store.get(blockHash)).toBe(first);
    expect(store.size).toBe(2);
    const countLimited = new PayloadStore(256 * 1024 * 1024, 2);
    expect(countLimited.hasCapacityForAlternate(5)).toBe(true);
    countLimited.add(first, "alternate");
    expect(countLimited.hasCapacityForAlternate(5)).toBe(false);
    expect(() => countLimited.add(second, "alternate")).toThrow();
    countLimited.add(second);
    expect(countLimited.size).toBe(2);
    countLimited.prune(8);
    expect(countLimited.hasCapacityForAlternate(8)).toBe(true);
  });

  it("shares blob bytes across a full revision window and preserves earlier sidecars", () => {
    const store = new PayloadStore();
    let firstBytes = 0;
    for (let i = 0; i < 256; i++) {
      const hash = Buffer.alloc(32);
      hash.writeUInt32BE(i, 28);
      const payload = mockBuiltPayload({slot: 5, blockHash: hash});
      payload.blobsBundle = {
        blobs: Array.from({length: 16}, (_, j) => new Uint8Array(131072).fill(j)),
        commitments: Array.from({length: 16}, (_, j) => new Uint8Array(48).fill(j)),
        proofs: Array.from({length: 16 * 128}, (_, j) => new Uint8Array(48).fill(j % 256)),
      };
      store.add({slot: 5, parentBlockRoot: Buffer.alloc(32), blockHash: "0x" + hash.toString("hex"), payload});
      if (i === 0) firstBytes = store.bytes;
    }
    expect(store.size).toBe(256);
    expect(store.bytes).toBeLessThan(32 * 1024 * 1024);
    const first = store.get("0x" + "00".repeat(32));
    const last = store.get("0x" + "00".repeat(31) + "ff");
    expect(first?.payload.blobsBundle.blobs).toHaveLength(16);
    expect(first?.payload.blobsBundle.blobs[15]).toBe(last?.payload.blobsBundle.blobs[15]);
    expect(first?.payload.blobsBundle.proofs[127][0]).toBe(127);
    store.prune(7);
    expect(store.size).toBe(256);
    expect(store.bytes).toBeGreaterThan(firstBytes);
    store.prune(8);
    expect(store.size).toBe(0);
    expect(store.bytes).toBe(0);
  });

  it("does not retain new blob bytes on failed admission or release another slot's sidecars", () => {
    const store = new PayloadStore(4 * 1024 * 1024, 2);
    const payload = mockBuiltPayload();
    payload.blobsBundle = {
      blobs: [new Uint8Array(131072)],
      commitments: [new Uint8Array(48)],
      proofs: Array.from({length: 128}, () => new Uint8Array(48)),
    };
    const first = {slot: 5, parentBlockRoot: Buffer.alloc(32), blockHash, payload};
    const later = {...first, slot: 6, blockHash: "0x" + "dd".repeat(32)};
    store.add(first);
    const one = store.bytes;
    store.add(later);
    expect(store.bytes).toBe(2 * one);
    const changed = {...payload, blobsBundle: {...payload.blobsBundle, blobs: [new Uint8Array(131072).fill(1)]}};
    expect(() => store.add({...first, blockHash: "0x" + "ee".repeat(32), payload: changed})).toThrow();
    expect(store.bytes).toBe(2 * one);
    store.prune(8);
    expect(store.bytes).toBe(one);
    expect(store.get(later.blockHash)?.payload.blobsBundle.blobs[0][0]).toBe(0);
    store.prune(9);
    expect(store.bytes).toBe(0);
  });

  it("returns no payload for an unknown hash and can prune an empty store", () => {
    const store = new PayloadStore();

    expect(store.get(blockHash)).toBeNull();
    expect(store.has(blockHash)).toBe(false);
    store.prune(8);
    expect(store.size).toBe(0);
  });

  it("rejects a new payload at capacity without evicting an earlier commitment", () => {
    const store = new PayloadStore(256 * 1024 * 1024, 1);
    const first = {slot: 5, parentBlockRoot: Buffer.alloc(32), blockHash, payload: mockBuiltPayload()};
    store.add(first);
    const bytes = store.bytes;
    expect(() => store.add({...first, blockHash: "0x" + "dd".repeat(32)})).toThrow();
    expect(store.get(blockHash)).toBe(first);
    expect(store.bytes).toBe(bytes);
    const tooSmall = new PayloadStore(bytes - 1);
    expect(() => tooSmall.add(first)).toThrow();
    expect(tooSmall.size).toBe(0);
    store.prune(8);
    expect(store.bytes).toBe(0);
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

  it("limits bytes per slot without preventing recovery of older larger commitments", () => {
    const store = new PayloadStore(8 * 1024 * 1024);
    const records = [5, 5, 6, 7, 8, 9].map((slot, index) => {
      const hash = Buffer.alloc(32, index + 1);
      const payload = mockBuiltPayload({slot, blockHash: hash});
      payload.executionPayload.transactions = SerializedList.fromArray([new Uint8Array(1100 * 1024)]);
      return {slot, parentBlockRoot: Buffer.alloc(32), blockHash: "0x" + hash.toString("hex"), payload};
    });
    store.add(records[0]);
    expect(() => store.add(records[1])).toThrow();
    expect(store.size).toBe(1);
    for (const record of records.slice(2, 5)) store.add(record);
    expect(store.size).toBe(4);
    store.add(records[1], "recovery");
    expect(store.size).toBe(5);
    expect(store.get(records[0].blockHash)).toBe(records[0]);
    store.prune(8);
    expect(store.size).toBe(3);
    store.add(records[5]);
    expect(store.size).toBe(4);
  });

  it("does not increase the size when the same payload is added twice", () => {
    const store = new PayloadStore();
    const stored = {slot: 5, parentBlockRoot: Buffer.alloc(32), blockHash, payload: mockBuiltPayload({slot: 5})};

    store.add(stored);
    store.add(stored);

    expect(store.size).toBe(1);
    expect(store.get(blockHash)).toEqual(stored);
  });

  it("retains a full revision budget for two previous slots, the current slot, and the next slot", () => {
    const store = new PayloadStore();
    const records = Array.from({length: 1024}, (_, index) => {
      const slot = 6 + Math.floor(index / 256);
      const hash = Buffer.alloc(32);
      hash.writeUInt32BE(index, 28);
      return {
        slot,
        parentBlockRoot: Buffer.alloc(32),
        blockHash: "0x" + hash.toString("hex"),
        payload: mockBuiltPayload({slot, blockHash: hash}),
      };
    });
    for (const record of records) store.add(record);
    store.prune(8);
    expect(store.size).toBe(1024);
    // One additional slot fits if the clock's pruning callback runs late.
    const delayed = records
      .slice(0, 256)
      .map((record) => ({...record, slot: 5, blockHash: `0x01${record.blockHash.slice(4)}`}));
    for (const record of delayed) store.add(record);
    expect(store.size).toBe(1280);
    const rejected = {...records[0], slot: 10, blockHash};
    expect(() => store.add(rejected)).toThrow();
    for (const record of records) {
      expect(store.get(record.blockHash), `retained revision ${record.blockHash}`).toBe(record);
    }
    store.prune(9);
    expect(store.size).toBe(768);
    store.add(rejected);
    expect(store.has(blockHash)).toBe(true);
    expect(store.has(records[0].blockHash)).toBe(false);
    expect(store.get(records[256].blockHash)).toBe(records[256]);
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
