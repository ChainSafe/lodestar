import {describe, expect, it} from "vitest";
import {PayloadStore} from "../../../src/services/payloadStore.js";
import {mockBuiltPayload} from "../utils/payload.js";

describe("PayloadStore", () => {
  const blockHash = "0x" + "cc".repeat(32);

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
});
