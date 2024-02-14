import {ApiError} from "@lodestar/api";
import {RootHex, Slot} from "@lodestar/types";
import {toHexString} from "@lodestar/utils";
import {AssertionResult, SimulationAssertion} from "../../interfaces.js";
import {everySlotMatcher} from "../matchers.js";

export interface HeadSummary {
  blockRoot: RootHex;
  slot: Slot;
}

export const headAssertion: SimulationAssertion<"head", HeadSummary> = {
  id: "head",
  match: everySlotMatcher,
  async capture({node}) {
    const head = await node.beacon.api.beacon.getBlockHeader("head");
    ApiError.assert(head);

    return {
      blockRoot: toHexString(head.response.data.root),
      slot: head.response.data.header.message.slot,
    };
  },
  async assert({nodes, node, store, slot, dependantStores}) {
    const errors: AssertionResult[] = [];

    // For first node we don't need to match the head
    if (node.id === nodes[0].id) return errors;

    const headRootNode0 = dependantStores["head" as const][nodes[0].beacon.id][slot].blockRoot;

    const headRootNode = store[slot].blockRoot;

    if (headRootNode0 !== headRootNode) {
      errors.push(["node have different heads", {headRootNode0, headRootNode}]);
    }

    return errors;
  },

  async dump({store, slot, nodes}) {
    /*
     * | Slot | Node 1 | Node 2 |
     * |------|--------|--------|
     * | 1    | 0x49d3 | 0x49d3 |
     * | 2    | 0x49d3 | 0x49d3 |
     * | 3    | 0x49d3 | 0x49d3 |
     */
    const result = [`Slot,${nodes.map((n) => n.beacon.id).join(", ")}`];
    for (let s = 1; s <= slot; s++) {
      result.push(`${s}, ${nodes.map((n) => store[n.beacon.id][s].blockRoot ?? "-").join(",")}`);
    }
    return {"headAssertion.csv": result.join("\n")};
  },
};
