import {beforeEach, describe, expect, it} from "vitest";
import {LinearGossipQueue} from "../../../../../src/network/processor/gossipQueues/linear.js";
import {DropType} from "../../../../../src/network/processor/gossipQueues/types.js";
import {QueueType} from "../../../../../src/util/queue/index.js";

describe("DefaultGossipQueues - drop by ratio", () => {
  const gossipQueue = new LinearGossipQueue<number>({
    maxLength: 10,
    type: QueueType.LIFO,
    dropOpts: {type: DropType.ratio, start: 0.1, step: 0.2},
  });

  beforeEach(() => {
    gossipQueue.clear();
    for (let i = 0; i < 9; i++) {
      gossipQueue.add(i);
    }
  });

  it("add and next", () => {
    // no drop
    expect(gossipQueue.length).toBe(9);
    expect(gossipQueue.add(9)).toBe(0);
    expect(gossipQueue.length).toBe(10);
    // LIFO, last in first out
    expect(gossipQueue.next()).toBe(9);
  });

  it("should drop by ratio", () => {
    expect(gossipQueue.add(9)).toBe(0);
    expect(gossipQueue.length).toBe(10);
    expect(gossipQueue.dropRatio).toBe(0.1);

    // drop 1 item (11 * 0.1)
    expect(gossipQueue.add(100)).toBe(1);
    expect(gossipQueue.length).toBe(10);
    // work around to get through the floating point precision
    expect(Math.floor(gossipQueue.dropRatio * 100) / 100).toBe(0.3);

    // drop 3 items (11 * 0.3)
    expect(gossipQueue.add(101)).toBe(3);
    expect(gossipQueue.length).toBe(8);
    expect(gossipQueue.dropRatio).toBe(0.5);

    // drop 5 items (11 * 0.5)
    expect(gossipQueue.add(102)).toBe(0);
    expect(gossipQueue.length).toBe(9);
    expect(gossipQueue.add(103)).toBe(0);
    expect(gossipQueue.length).toBe(10);
    expect(gossipQueue.add(104)).toBe(5);
    expect(gossipQueue.length).toBe(6);
    expect(gossipQueue.dropRatio).toBe(0.7);

    // node is recovering
    gossipQueue.clear();
    for (let i = 0; i < 10; i++) {
      expect(gossipQueue.add(i)).toBe(0);
      expect(gossipQueue.next()).toBe(i);
      expect(gossipQueue.dropRatio).toBe(0.7);
    }

    // node is in good status
    expect(gossipQueue.add(1000)).toBe(0);
    expect(gossipQueue.length).toBe(1);
    // drop ratio is reset
    expect(gossipQueue.dropRatio).toBe(0.1);
  });
});

describe("GossipQueues - drop by count", () => {
  const gossipQueue = new LinearGossipQueue<number>({
    maxLength: 10,
    type: QueueType.LIFO,
    dropOpts: {type: DropType.count, count: 1},
  });

  beforeEach(() => {
    gossipQueue.clear();
    for (let i = 0; i < 9; i++) {
      gossipQueue.add(i);
    }
  });

  it("add and next", () => {
    // no drop
    expect(gossipQueue.length).toBe(9);
    expect(gossipQueue.add(9)).toBe(0);
    expect(gossipQueue.length).toBe(10);
    // LIFO, last in first out
    expect(gossipQueue.next()).toBe(9);
  });

  it("should drop by count", () => {
    expect(gossipQueue.add(9)).toBe(0);
    expect(gossipQueue.length).toBe(10);

    // drop 1 item
    expect(gossipQueue.add(100)).toBe(1);
    expect(gossipQueue.length).toBe(10);

    // drop 1 items
    expect(gossipQueue.add(101)).toBe(1);
    expect(gossipQueue.length).toBe(10);
  });
});

describe("LinearGossipQueue drop observation", () => {
  it.each([QueueType.FIFO, QueueType.LIFO])("observes count eviction and clear for %s", (type) => {
    const dropped: number[] = [];
    const queue = new LinearGossipQueue<number>({
      type,
      maxLength: 2,
      dropOpts: {type: DropType.count, count: 1},
      onDrop: (item) => dropped.push(item),
    });
    queue.add(1);
    queue.add(2);
    expect(queue.add(3)).toBe(1);
    expect(dropped).toEqual(type === QueueType.FIFO ? [3] : [1]);
    expect(queue.next()).toBe(type === QueueType.FIFO ? 1 : 3);
    queue.clear();
    expect(dropped).toEqual(type === QueueType.FIFO ? [3, 2] : [1, 2]);
    queue.clear();
    expect(dropped).toHaveLength(2);
    expect(queue.add(4)).toBe(0);
    expect(queue.next()).toBe(4);
    expect(queue.length).toBe(0);
    expect(dropped).toHaveLength(2);
  });

  it.each([QueueType.FIFO, QueueType.LIFO])("observes ratio eviction in order for %s", (type) => {
    const dropped: number[] = [];
    const queue = new LinearGossipQueue<number>({
      type,
      maxLength: 3,
      dropOpts: {type: DropType.ratio, start: 0.5, step: 0.1},
      onDrop: (item) => dropped.push(item),
    });
    for (const item of [1, 2, 3]) queue.add(item);
    expect(queue.add(4)).toBe(2);
    expect(dropped).toEqual(type === QueueType.FIFO ? [4, 3] : [1, 2]);
    expect(queue.getAll()).toEqual(type === QueueType.FIFO ? [1, 2] : [3, 4]);
  });
});
