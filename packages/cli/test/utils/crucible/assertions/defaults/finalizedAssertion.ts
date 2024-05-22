import {ApiError} from "@lodestar/api";
import {Slot} from "@lodestar/types";
import {AssertionResult, SimulationAssertion} from "../../interfaces.js";
import {everySlotMatcher} from "../matchers.js";

export const finalizedAssertion: SimulationAssertion<"finalized", Slot> = {
  id: "finalized",
  match: everySlotMatcher,
  async capture({node}) {
    const finalized = await node.beacon.api.beacon.getBlockHeader("finalized");
    ApiError.assert(finalized);
    return finalized.response.data.header.message.slot ?? 0;
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
