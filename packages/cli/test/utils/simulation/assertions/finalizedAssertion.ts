import {Slot} from "@lodestar/types";
import {SimulationAssertion} from "../interfaces.js";
import {everyEpochMatcher} from "./matchers.js";

export const finalizedAssertion: SimulationAssertion<"finalized", Slot> = {
  key: "finalized",
  match: everyEpochMatcher,
  async capture({node}) {
    const finalized = await node.cl.api.beacon.getBlockHeader("finalized");
    return finalized.data.header.message.slot;
  },
  async assert({nodes, store, clock, epoch}) {
    const errors: string[] = [];
    const startSlot = clock.getFirstSlotOfEpoch(epoch);
    const endSlot = clock.getLastSlotOfEpoch(epoch);

    for (const node of nodes) {
      for (let slot = startSlot; slot <= endSlot; slot++) {
        // The slots start finalizing from 4th epoch
        const expectedFinalizedSlot =
          slot < clock.getLastSlotOfEpoch(4) ? 0 : clock.getFirstSlotOfEpoch(clock.getEpochForSlot(slot) - 2);
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
    }

    return errors;
  },
};
