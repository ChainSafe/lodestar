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
  async capture({node, slot}) {
    const head = await node.cl.api.beacon.getBlockHeader("head");
    ApiError.assert(head);

    console.log("head", node.cl.id, head.response.data.header.message.slot);

    return {
      blockRoot: toHexString(head.response.data.root),
      slot: head.response.data.header.message.slot,
    };
  },
  async assert({nodes, store, slot}) {
    const errors: AssertionResult[] = [];

    const headRootNode0 = store[nodes[0].cl.id][slot].blockRoot;

    for (let i = 1; i < nodes.length; i++) {
      const headRootNodeN = store[nodes[i].cl.id][slot].blockRoot;

      if (headRootNode0 !== headRootNodeN) {
        errors.push(["node have different heads", {node: nodes[i].cl.id, headRootNode0, headRootNodeN}]);
      }
    }

    return errors;
  },
};
