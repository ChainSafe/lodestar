import {describe, it, expect, beforeEach, afterEach, vi} from "vitest";
import {IndexedGossipQueueMinSize} from "../../../../../src/network/processor/gossipQueues/indexed.js";

type Item = {
  key: string;
  indexed?: string;
  queueAddedMs?: number;
};

function toItem(key: string): Item {
  return {key};
}

function toIndexedItem(key: string): Item {
  return {key, indexed: key.substring(0, 1), queueAddedMs: 0};
}

describe("IndexedGossipQueueMinSize", () => {
  const gossipQueue = new IndexedGossipQueueMinSize<Item>({
    maxLength: 12,
    indexFn: (item: Item) => item.key.substring(0, 1),
    minChunkSize: 2,
    maxChunkSize: 3,
  });

  beforeEach(() => {
    vi.useFakeTimers({now: 0});
    gossipQueue.clear();
    for (const letter of ["a", "b", "c"]) {
      for (let i = 0; i < 4; i++) {
        gossipQueue.add(toItem(`${letter}${i}`));
      }
    }
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.clearAllTimers();
  });

  it("should return items with minChunkSize", () => {
    expect(gossipQueue.next()).toEqual(["c3", "c2", "c1"].map(toIndexedItem));
    expect(gossipQueue.length).toBe(9);
    expect(gossipQueue.next()).toEqual(["b3", "b2", "b1"].map(toIndexedItem));
    expect(gossipQueue.length).toBe(6);
    expect(gossipQueue.next()).toEqual(["a3", "a2", "a1"].map(toIndexedItem));
    expect(gossipQueue.length).toBe(3);
    // no more keys with min chunk size but not enough wait time
    expect(gossipQueue.next()).toBeNull();
    vi.advanceTimersByTime(20);
    expect(gossipQueue.next()).toBeNull();
    vi.advanceTimersByTime(30);
    // should pick items of the last key
    expect(gossipQueue.next()).toEqual(["c0"].map(toIndexedItem));
    expect(gossipQueue.length).toBe(2);
    expect(gossipQueue.next()).toEqual(["b0"].map(toIndexedItem));
    expect(gossipQueue.length).toBe(1);
    expect(gossipQueue.next()).toEqual(["a0"].map(toIndexedItem));
    expect(gossipQueue.length).toBe(0);
    expect(gossipQueue.next()).toBeNull();
  });

  it("should drop oldest item", () => {
    expect(gossipQueue.add(toItem("d0"))).toBe(1);
    expect(gossipQueue.add(toItem("d1"))).toBe(1);
    expect(gossipQueue.add(toItem("d2"))).toBe(1);
    expect(gossipQueue.length).toBe(12);
    expect(gossipQueue.getAll()).toEqual(
      ["a3", "b0", "b1", "b2", "b3", "c0", "c1", "c2", "c3", "d0", "d1", "d2"].map(toIndexedItem)
    );
    // key "a" now only has 1 item
    expect(gossipQueue.next()).toEqual(["d2", "d1", "d0"].map(toIndexedItem));
    expect(gossipQueue.length).toBe(9);
  });
});
