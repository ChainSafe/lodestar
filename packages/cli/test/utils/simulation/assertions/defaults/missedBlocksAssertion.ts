import {isTruthy} from "../../../../utils.js";
import {AssertionMatch, SimulationAssertion} from "../../interfaces.js";
import {headAssertion} from "./headAssertion.js";

export const missedBlocksAssertion: SimulationAssertion<"missedBlocks", number[], [typeof headAssertion]> = {
  id: "missedBlocks",
  match: ({clock, slot}) => {
    return clock.isLastSlotOfEpoch(slot) ? AssertionMatch.Capture | AssertionMatch.Assert : AssertionMatch.None;
  },
  dependencies: [headAssertion],

  async capture({node, slot, epoch, clock, dependantStores}) {
    // We need to start from the first slot as we don't store data for genesis
    const startSlot = epoch === 0 ? 1 : clock.getFirstSlotOfEpoch(epoch);
    const endSlot = slot;

    const missedSlots: number[] = [];

    for (let slot = startSlot; slot < endSlot; slot++) {
      const head = dependantStores["head"][node.cl.id][slot];
      if (!isTruthy(head) || !head.slot) {
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
