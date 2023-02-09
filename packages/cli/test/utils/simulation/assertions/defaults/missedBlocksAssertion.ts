import {SimulationAssertion} from "../../interfaces.js";
import {everyEpochMatcher} from "../matchers.js";
import {headAssertion} from "./headAssertion.js";

export const missedBlocksAssertion: SimulationAssertion<"missedBlocks", number[], [typeof headAssertion]> = {
  id: "missedBlocks",
  match: everyEpochMatcher,
  dependencies: [headAssertion],

  async capture({node, slot, epoch, clock, dependantStores}) {
    if (!clock.isLastSlotOfEpoch(slot)) return null;

    // We need to start from the first slot as we don't store data for genesis
    const startSlot = epoch === 0 ? 1 : clock.getFirstSlotOfEpoch(epoch);
    const endSlot = slot;

    const missedSlots: number[] = [];

    for (let slot = startSlot; slot < endSlot; slot++) {
      if (!dependantStores["head"][node.cl.id][slot].slot) {
        missedSlots.push(slot);
      }
    }
    return missedSlots;
  },

  async assert({nodes, store, slot}) {
    const errors: string[] = [];
    const missedBlocksOnFirstNode = store[nodes[0].cl.id][slot];

    for (let i = 1; i < nodes.length; i++) {
      const missedBlocksOnNode = store[nodes[i].cl.id][slot];

      if (missedBlocksOnNode !== missedBlocksOnFirstNode) {
        `node has different missed blocks than node 0. ${JSON.stringify({
          id: nodes[i].cl.id,
          missedBlocksOnNode,
          missedBlocksOnFirstNode,
        })}`;
      }
    }

    return errors;
  },
};
