import {ApiError} from "@lodestar/api";
import {Slot} from "@lodestar/types";
import {SimulationAssertion} from "../../interfaces.js";
import {everySlotMatcher} from "../matchers.js";

export const finalizedAssertion: SimulationAssertion<"finalized", Slot> = {
  id: "finalized",
  match: everySlotMatcher,
  async capture({node}) {
    const finalized = await node.cl.api.beacon.getBlockHeader("finalized");
    ApiError.assert(finalized);
    return finalized.response.data.header.message.slot ?? 0;
  },
  async assert({nodes, store, slot, clock, epoch}) {
    const errors: string[] = [];
    const expectedFinalizedSlot = slot <= clock.getLastSlotOfEpoch(3) ? 0 : clock.getFirstSlotOfEpoch(epoch - 2);

    for (const node of nodes) {
      const finalizedSlot = store[node.cl.id][slot];

      if (finalizedSlot !== expectedFinalizedSlot) {
        errors.push(
          `node has not finalized expected slot. ${JSON.stringify({
            id: node.cl.id,
            slot,
            epoch,
            finalizedSlot,
            expectedFinalizedSlot,
          })}`
        );
      }
    }

    return errors;
  },
};
