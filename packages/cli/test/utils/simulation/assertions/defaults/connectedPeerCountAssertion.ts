import {ApiError} from "@lodestar/api";
import {AssertionResult, SimulationAssertion} from "../../interfaces.js";
import {everySlotMatcher} from "../matchers.js";

export const connectedPeerCountAssertion: SimulationAssertion<"connectedPeerCount", number> = {
  id: "connectedPeerCount",
  match: everySlotMatcher,
  async capture({node}) {
    const res = await node.cl.api.node.getPeerCount();
    ApiError.assert(res);
    return res.response.data.connected;
  },
  async assert({nodes, store, clock}) {
    const errors: AssertionResult[] = [];

    for (const node of nodes) {
      if (store[node.cl.id][clock.currentSlot] < nodes.length - 1) {
        errors.push([
          "node has has low peer connections",
          {
            node: node.cl.id,
            connections: store[node.cl.id][clock.currentSlot],
            expectedConnections: nodes.length - 1,
          },
        ]);
      }
    }

    return errors;
  },
};
