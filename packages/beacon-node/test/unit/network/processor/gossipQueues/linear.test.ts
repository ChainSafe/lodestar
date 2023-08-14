import {expect} from "chai";
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
    expect(gossipQueue.length).to.be.equal(9);
    expect(gossipQueue.add(9)).to.be.equal(0);
    expect(gossipQueue.length).to.be.equal(10);
    // LIFO, last in first out
    expect(gossipQueue.next()).to.be.equal(9);
  });

  it("should drop by ratio", () => {
    expect(gossipQueue.add(9)).to.be.equal(0);
    expect(gossipQueue.length).to.be.equal(10);
    expect(gossipQueue.dropRatio).to.be.equal(0.1);

    // drop 1 item (11 * 0.1)
    expect(gossipQueue.add(100)).to.be.equal(1);
    expect(gossipQueue.length).to.be.equal(10);
    // work around to get through the floating point precision
    expect(Math.floor(gossipQueue.dropRatio * 100) / 100).to.be.equal(0.3);

    // drop 3 items (11 * 0.3)
    expect(gossipQueue.add(101)).to.be.equal(3);
    expect(gossipQueue.length).to.be.equal(8);
    expect(gossipQueue.dropRatio).to.be.equal(0.5);

    // drop 5 items (11 * 0.5)
    expect(gossipQueue.add(102)).to.be.equal(0);
    expect(gossipQueue.length).to.be.equal(9);
    expect(gossipQueue.add(103)).to.be.equal(0);
    expect(gossipQueue.length).to.be.equal(10);
    expect(gossipQueue.add(104)).to.be.equal(5);
    expect(gossipQueue.length).to.be.equal(6);
    expect(gossipQueue.dropRatio).to.be.equal(0.7);

    // node is recovering
    gossipQueue.clear();
    for (let i = 0; i < 10; i++) {
      expect(gossipQueue.add(i)).to.be.equal(0);
      expect(gossipQueue.next()).to.be.equal(i);
      expect(gossipQueue.dropRatio).to.be.equal(0.7);
    }

    // node is in good status
    expect(gossipQueue.add(1000)).to.be.equal(0);
    expect(gossipQueue.length).to.be.equal(1);
    // drop ratio is reset
    expect(gossipQueue.dropRatio).to.be.equal(0.1);
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
    expect(gossipQueue.length).to.be.equal(9);
    expect(gossipQueue.add(9)).to.be.equal(0);
    expect(gossipQueue.length).to.be.equal(10);
    // LIFO, last in first out
    expect(gossipQueue.next()).to.be.equal(9);
  });

  it("should drop by count", () => {
    expect(gossipQueue.add(9)).to.be.equal(0);
    expect(gossipQueue.length).to.be.equal(10);

    // drop 1 item
    expect(gossipQueue.add(100)).to.be.equal(1);
    expect(gossipQueue.length).to.be.equal(10);

    // drop 1 items
    expect(gossipQueue.add(101)).to.be.equal(1);
    expect(gossipQueue.length).to.be.equal(10);
  });
});
