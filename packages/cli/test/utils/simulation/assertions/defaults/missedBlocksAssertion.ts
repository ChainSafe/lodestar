import {isNullish} from "../../../../utils.js";
import {AssertionMatch, AssertionResult, SimulationAssertion} from "../../interfaces.js";
import {arrayEquals} from "../../utils/index.js";
import {headAssertion} from "./headAssertion.js";

export const missedBlocksAssertion: SimulationAssertion<"missedBlocks", number[], [typeof headAssertion]> = {
  id: "missedBlocks",
  match: ({clock, slot}) => {
    return clock.isLastSlotOfEpoch(slot) ? AssertionMatch.Capture | AssertionMatch.Assert : AssertionMatch.None;
  },
  dependencies: [headAssertion],
  async capture({node, epoch, slot, dependantStores, clock}) {
    // We need to start from the first slot as we don't store data for genesis
    const startSlot = epoch === 0 ? 1 : clock.getFirstSlotOfEpoch(epoch);
    const endSlot = slot;
    const missedBlocks: number[] = [];

    for (let slot = startSlot; slot < endSlot; slot++) {
      // If some value of head is present for that slot then it was not missed
      if (isNullish(dependantStores[headAssertion.id][node.cl.id][slot])) {
        missedBlocks.push(slot);
      }
    }
    console.log({node: node.cl.id, missedBlocks, heads: Object.keys(dependantStores[headAssertion.id][node.cl.id])});
    return missedBlocks;
  },

  async assert({nodes, slot, store}) {
    const errors: AssertionResult[] = [];

    const missedBlocksOnFirstNode = store[nodes[0].cl.id][slot];

    for (let i = 1; i < nodes.length; i++) {
      const missedBlocks = store[nodes[i].cl.id][slot];

      if (!arrayEquals(missedBlocks, missedBlocksOnFirstNode)) {
        errors.push([
          "node has different missed blocks than first node",
          {
            node: nodes[i].cl.id,
            missedBlocks,
            missedBlocksOnFirstNode,
          },
        ]);
      }
    }

    return errors;
  },
};
