import {AttestationQueueUnknownBlock} from "../../../../src/network/processor/gossipAttestationQueue.js";
import {expectDeepEquals, expectEquals} from "../../../utils/chai.js";

describe("AttestationQueueUnknownBlock", () => {
  describe("add", () => {
    it("adds an item to the queue", () => {
      const queue = new AttestationQueueUnknownBlock<number>();
      queue.add(1, 1, "0x1234");
      expectEquals(queue.size, 1);
    });

    it("adds multiple items to the same slot and block root", () => {
      const queue = new AttestationQueueUnknownBlock<number>();
      queue.add(1, 1, "0x1234");
      queue.add(2, 1, "0x1234");
      expectEquals(queue.size, 2);
    });

    it("adds multiple items to different slots and block roots", () => {
      const queue = new AttestationQueueUnknownBlock<number>();
      queue.add(1, 1, "0x1234");
      queue.add(2, 2, "0x5678");
      expectEquals(queue.size, 2);
    });
  });

  describe("pruneBySlot", () => {
    it("removes all items for the given slot", () => {
      const queue = new AttestationQueueUnknownBlock<number>();
      queue.add(1, 1, "0x1234");
      queue.add(2, 2, "0x5678");
      queue.pruneBySlot(1);
      expectEquals(queue.size, 1);
    });

    it("does nothing if there are no items for the given slot", () => {
      const queue = new AttestationQueueUnknownBlock<number>();
      queue.add(1, 1, "0x1234");
      queue.add(2, 2, "0x5678");
      queue.pruneBySlot(3);
      expectEquals(queue.size, 2);
    });
  });

  describe("consumeByBlockRoot", () => {
    it("returns all items for the given block root and removes them from the queue", () => {
      const queue = new AttestationQueueUnknownBlock<number>();
      queue.add(1, 1, "0x1234");
      queue.add(2, 1, "0x1234");
      queue.add(3, 2, "0x5678");
      const results = [...queue.consumeByBlockRoot("0x1234")];
      expectDeepEquals(results, [{slot: 1, items: [1, 2]}]);
      expectEquals(queue.size, 1);
    });

    it("returns items for multiple slots and removes them from the queue", () => {
      const queue = new AttestationQueueUnknownBlock<number>();
      queue.add(1, 1, "0x1234");
      queue.add(2, 1, "0x1234");
      queue.add(3, 2, "0x5678");
      queue.add(4, 2, "0x1234");
      const results = [...queue.consumeByBlockRoot("0x1234")];
      expectDeepEquals(results, [
        {slot: 1, items: [1, 2]},
        {slot: 2, items: [4]},
      ]);
      expectEquals(queue.size, 1);
    });

    it("returns an empty iterator if there are no items for the given block root", () => {
      const queue = new AttestationQueueUnknownBlock<number>();
      queue.add(1, 1, "0x1234");
      queue.add(2, 1, "0x1234");
      expectDeepEquals([...queue.consumeByBlockRoot("0x5678")], []);
    });
  });
});
