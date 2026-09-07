import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
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
  return {key, indexed: key.substring(0, 1)};
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

describe("IndexedGossipQueueMinSize drop observation", () => {
  afterEach(() => vi.useRealTimers());

  it("observes first-key eviction, invalid keys and clear without observing transfer", () => {
    const dropped: Item[] = [];
    const queue = new IndexedGossipQueueMinSize<Item>({
      maxLength: 2,
      minChunkSize: 1,
      maxChunkSize: 1,
      indexFn: (item) => item.key || null,
      onDrop: (item) => dropped.push(item),
    });
    const a = toItem("a");
    const b = toItem("b");
    const c = toItem("c");
    const invalid = toItem("");
    queue.add(a);
    queue.add(b);
    expect(queue.add(c)).toBe(1);
    expect(dropped).toEqual([a]);
    expect(dropped[0]).toBe(a);
    expect(queue.add(invalid)).toBe(1);
    expect(dropped[1]).toBe(invalid);
    expect(queue.next()).toEqual([c]);
    expect(dropped).toEqual([a, invalid]);
    queue.clear();
    expect(dropped).toEqual([a, invalid, b]);
    queue.clear();
    expect(dropped).toHaveLength(3);
    expect(queue.length).toBe(0);
    expect(queue.keySize).toBe(0);
    expect(queue.getDataAgeMs()).toEqual([]);
    queue.add(a);
    expect(queue.next()).toEqual([a]);
    expect(dropped).toHaveLength(3);
  });

  it("reports an invalid key without an observer", () => {
    const queue = new IndexedGossipQueueMinSize<Item>({
      maxLength: 2,
      minChunkSize: 2,
      maxChunkSize: 2,
      indexFn: () => null,
    });
    expect(queue.add(toItem(""))).toBe(1);
    expect(queue.length).toBe(0);
    queue.clear();
    queue.clear();
  });

  it.each([true, false])("resets minimum-wait state on clear, observer=%s", (observe) => {
    vi.useFakeTimers({now: 100});
    const dropped: Item[] = [];
    const queue = new IndexedGossipQueueMinSize<Item>({
      maxLength: 2,
      minChunkSize: 2,
      maxChunkSize: 2,
      indexFn: (item) => item.key,
      onDrop: observe ? (item) => dropped.push(item) : undefined,
    });
    queue.add(toItem("a"));
    expect(queue.next()).toBeNull();
    queue.clear();
    vi.setSystemTime(0);
    const b = toItem("b");
    queue.add(b);
    vi.advanceTimersByTime(50);
    expect(queue.next()).toEqual([b]);
    expect(dropped).toHaveLength(observe ? 1 : 0);
  });
});
