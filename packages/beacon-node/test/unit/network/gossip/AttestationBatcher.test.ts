import {expect} from "chai";
import {AttestationBatcher} from "../../../../src/network/processor/gossipAttestationQueue.js";

describe("AttestationBatcher", () => {
  const batchSize = 3;

  it("should create an empty batcher", () => {
    const batcher = new AttestationBatcher<string>(batchSize);
    expect(batcher.size).equals(0);
  });

  it("should add items to batches", () => {
    const batcher = new AttestationBatcher<string>(batchSize);
    batcher.add("item1");
    batcher.add("item2");
    expect(batcher.size).equals(1);
  });

  it("should add items to multiple batches if necessary", () => {
    const batcher = new AttestationBatcher<string>(batchSize);
    for (let i = 0; i < batchSize * 2; i++) {
      batcher.add(`item${i}`);
    }
    expect(batcher.size).equals(2);
  });

  it("should return batches in order they were added", () => {
    const batcher = new AttestationBatcher<string>(batchSize);
    batcher.add("item1");
    batcher.add("item2");
    batcher.add("item3");
    const batches = Array.from(batcher.consume());
    expect(batches).to.deep.equal([["item1", "item2", "item3"]]);

    expect(batcher.size).equals(0); // Check that batcher is empty after consume call
    expect(Array.from(batcher.consume())).to.deep.equal([]);
  });

  it("should return multiple batches in order they were added", () => {
    const batcher = new AttestationBatcher<string>(batchSize);
    for (let i = 0; i < batchSize * 2; i++) {
      batcher.add(`item${i}`);
    }
    const batches = Array.from(batcher.consume());
    expect(batches.length).equals(2);
    expect(batches[0]).to.deep.equal(
      Array(batchSize)
        .fill(null)
        .map((_, i) => `item${i}`)
    );
    expect(batches[1]).to.deep.equal(
      Array(batchSize)
        .fill(null)
        .map((_, i) => `item${i + batchSize}`)
    );

    expect(batcher.size).equals(0); // Check that batcher is empty after consume call
    expect(Array.from(batcher.consume())).to.deep.equal([]);
  });
});
