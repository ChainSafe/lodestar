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
      if (isNullish(dependantStores[headAssertion.id][node.beacon.id][slot])) {
        missedBlocks.push(slot);
      }
    }

    return missedBlocks;
  },

  async assert({nodes, node, slot, store, dependantStores}) {
    const errors: AssertionResult[] = [];

    // For first node we don't need to match
    if (node.id === nodes[0].id) return errors;

    const missedBlocksOnFirstNode = dependantStores["missedBlocks" as const][nodes[0].beacon.id][slot];

    const missedBlocks = store[slot];

    if (!arrayEquals(missedBlocks, missedBlocksOnFirstNode)) {
      errors.push([
        "node has different missed blocks than first node",
        {
          missedBlocks,
          missedBlocksOnFirstNode,
        },
      ]);
    }

    return errors;
  },
};
