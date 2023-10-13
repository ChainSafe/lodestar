import {describe, it, expect, beforeEach} from "vitest";
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
