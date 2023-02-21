import {AttestationQueueKnownBlock} from "../../../../src/network/processor/gossipAttestationQueue.js";
import {expectDeepEquals, expectEquals} from "../../../utils/chai.js";

describe("AttestationQueueKnownBlock", () => {
  const ATTESTATION_BATCH_SIZE = 3;
  const target = "0x01";

  it("adds items to the queue and consumes them by slot", () => {
    const queue = new AttestationQueueKnownBlock<number>(ATTESTATION_BATCH_SIZE);
    const slotOdd = 0;
    const slotEven = 1;
    const slotNone = 2;

    // Add items to the queue
    for (let i = 0; i < ATTESTATION_BATCH_SIZE * 3; i++) {
      if (i % 2 === 0) {
        queue.add(i, slotOdd, target);
      } else {
        queue.add(i, slotEven, target);
      }
    }

    // Returns batched even items on slot1
    expectDeepEquals(Array.from(queue.consumeBySlot(slotOdd)), [
      {target, items: [0, 2, 4]},
      {target, items: [6, 8]},
    ]);
    expectDeepEquals(Array.from(queue.consumeBySlot(slotOdd)), []);

    // Returns batches odd items on slot2
    expectDeepEquals(Array.from(queue.consumeBySlot(slotEven)), [
      {target, items: [1, 3, 5]},
      {target, items: [7]},
    ]);
    expectDeepEquals(Array.from(queue.consumeBySlot(slotEven)), []);

    // Returns empty for slot without items
    expectDeepEquals(Array.from(queue.consumeBySlot(slotNone)), []);
  });

  it("iterate once then continue", () => {
    const queue = new AttestationQueueKnownBlock<number>(ATTESTATION_BATCH_SIZE);
    const slot = 0;

    // Add items to the queue
    for (let i = 0; i < ATTESTATION_BATCH_SIZE * 3; i++) {
      queue.add(i, slot, target);
    }

    // First iteration, batch 1
    for (const batch of queue.consumeBySlot(slot)) {
      expectDeepEquals(batch, {target, items: [0, 1, 2]});
      break;
    }

    // Second iteration batch 2
    for (const batch of queue.consumeBySlot(slot)) {
      expectDeepEquals(batch, {target, items: [3, 4, 5]});
      break;
    }
  });

  it("correctly updates the size when adding and consuming items", () => {
    const queue = new AttestationQueueKnownBlock<boolean>(ATTESTATION_BATCH_SIZE);
    const slot = 1;
    const targetHex = "0x01";
    let itemCount = 0;

    // Verify that the queue is empty initially
    expectEquals(queue.size, 0);

    // Add items to the queue
    for (let i = 0; i < ATTESTATION_BATCH_SIZE * 3; i++) {
      queue.add(true, slot, targetHex);
      itemCount++;
      expectEquals(queue.size, itemCount);
    }

    // Verify that the queue size is correct after adding items
    expectEquals(queue.size, ATTESTATION_BATCH_SIZE * 3);

    // Consume items from the queue by slot
    for (const batch of queue.consumeBySlot(slot)) {
      // Verify that the queue size is updated correctly after consuming items
      itemCount -= batch.items.length;
      expectEquals(queue.size, itemCount);
    }

    // Verify that the queue size is correct after consuming all items
    expectEquals(queue.size, 0);
  });
});
