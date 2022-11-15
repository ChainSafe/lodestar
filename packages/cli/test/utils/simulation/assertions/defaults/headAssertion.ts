import {toHexString} from "@lodestar/utils";
import {SimulationAssertion} from "../../interfaces.js";
import {everySlotMatcher} from "../matchers.js";

export const headAssertion: SimulationAssertion<"head", string> = {
  id: "head",
  async capture({node}) {
    const head = await node.cl.api.beacon.getBlockHeader("head");
    return toHexString(head.data.root);
  },

  match: everySlotMatcher,
  async assert({nodes, store, slot}) {
    const errors: string[] = [];

    const headOnFirstNode = store[nodes[0].cl.id][slot];

    for (let i = 1; i < nodes.length; i++) {
      const headOnNNode = store[nodes[i].cl.id][slot];

      if (headOnFirstNode !== headOnNNode) {
        errors.push(`node have different heads. ${JSON.stringify({slot, headOnFirstNode, headOnNNode})}`);
      }
    }

    return errors;
  },
};
