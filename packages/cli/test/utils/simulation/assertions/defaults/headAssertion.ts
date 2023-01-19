import {ApiError} from "@lodestar/api";
import {RootHex, Slot} from "@lodestar/types";
import {toHexString} from "@lodestar/utils";
import {SimulationAssertion} from "../../interfaces.js";
import {everySlotMatcher} from "../matchers.js";

export interface HeadSummary {
  blockRoot: RootHex;
  slot: Slot;
}

export const headAssertion: SimulationAssertion<"head", HeadSummary> = {
  id: "head",
  async capture({node}) {
    const head = await node.cl.api.beacon.getBlockHeader("head");
    ApiError.assert(head);

    return {
      blockRoot: toHexString(head.response.data.root),
      slot: head.response.data.header.message.slot,
    };
  },

  match: everySlotMatcher,
  async assert({nodes, store, slot}) {
    const errors: string[] = [];

    const headRootNode0 = store[nodes[0].cl.id][slot].blockRoot;

    for (let i = 1; i < nodes.length; i++) {
      const headRootNodeN = store[nodes[i].cl.id][slot].blockRoot;

      if (headRootNode0 !== headRootNodeN) {
        errors.push(`node have different heads. ${JSON.stringify({slot, headRootNode0, headRootNodeN})}`);
      }
    }

    return errors;
  },
};
