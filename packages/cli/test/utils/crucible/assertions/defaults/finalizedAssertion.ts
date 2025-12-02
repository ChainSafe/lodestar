import {Slot} from "@lodestar/types";
import {Assertion, AssertionResult} from "../../interfaces.js";
import {everySlotMatcher} from "../matchers.js";

export const finalizedAssertion: Assertion<"finalized", Slot> = {
  id: "finalized",
  match: everySlotMatcher,
  async capture({node}) {
    const finalized = (await node.beacon.api.beacon.getBlockHeader({blockId: "finalized"})).value();
    return finalized.header.message.slot ?? 0;
  },
  async assert({store, slot, clock, epoch}) {
    const errors: AssertionResult[] = [];
    const expectedFinalizedSlot = slot <= clock.getLastSlotOfEpoch(3) ? 0 : clock.getFirstSlotOfEpoch(epoch - 2);

    const finalizedSlot = store[slot];

    if (finalizedSlot !== expectedFinalizedSlot) {
      errors.push([
        "node has not finalized expected slot",
        {
          finalizedSlot,
          expectedFinalizedSlot,
        },
      ]);
    }

    return errors;
  },
};
