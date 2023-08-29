import {expect} from "chai";
import sinon from "sinon";
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

  const sandbox = sinon.createSandbox();

  beforeEach(() => {
    sandbox.useFakeTimers();
    gossipQueue.clear();
    for (const letter of ["a", "b", "c"]) {
      for (let i = 0; i < 4; i++) {
        gossipQueue.add(toItem(`${letter}${i}`));
      }
    }
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should return items with minChunkSize", () => {
    expect(gossipQueue.next()).to.be.deep.equal(["c3", "c2", "c1"].map(toIndexedItem));
    expect(gossipQueue.length).to.be.equal(9);
    expect(gossipQueue.next()).to.be.deep.equal(["b3", "b2", "b1"].map(toIndexedItem));
    expect(gossipQueue.length).to.be.equal(6);
    expect(gossipQueue.next()).to.be.deep.equal(["a3", "a2", "a1"].map(toIndexedItem));
    expect(gossipQueue.length).to.be.equal(3);
    // no more keys with min chunk size but not enough wait time
    expect(gossipQueue.next()).to.be.null;
    sandbox.clock.tick(20);
    expect(gossipQueue.next()).to.be.null;
    sandbox.clock.tick(30);
    // should pick items of the last key
    expect(gossipQueue.next()).to.be.deep.equal(["c0"].map(toIndexedItem));
    expect(gossipQueue.length).to.be.equal(2);
    expect(gossipQueue.next()).to.be.deep.equal(["b0"].map(toIndexedItem));
    expect(gossipQueue.length).to.be.equal(1);
    expect(gossipQueue.next()).to.be.deep.equal(["a0"].map(toIndexedItem));
    expect(gossipQueue.length).to.be.equal(0);
    expect(gossipQueue.next()).to.be.null;
  });

  it("should drop oldest item", () => {
    expect(gossipQueue.add(toItem("d0"))).to.be.equal(1);
    expect(gossipQueue.add(toItem("d1"))).to.be.equal(1);
    expect(gossipQueue.add(toItem("d2"))).to.be.equal(1);
    expect(gossipQueue.length).to.be.equal(12);
    expect(gossipQueue.getAll()).to.be.deep.equal(
      ["a3", "b0", "b1", "b2", "b3", "c0", "c1", "c2", "c3", "d0", "d1", "d2"].map(toIndexedItem)
    );
    // key "a" now only has 1 item
    expect(gossipQueue.next()).to.be.deep.equal(["d2", "d1", "d0"].map(toIndexedItem));
    expect(gossipQueue.length).to.be.equal(9);
  });
});
