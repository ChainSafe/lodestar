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
};
