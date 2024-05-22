import {ApiError} from "@lodestar/api";
import {AssertionResult, SimulationAssertion} from "../../interfaces.js";
import {everySlotMatcher} from "../matchers.js";

export const connectedPeerCountAssertion: SimulationAssertion<"connectedPeerCount", number> = {
  id: "connectedPeerCount",
  match: everySlotMatcher,
  async capture({node}) {
    const res = await node.beacon.api.node.getPeerCount();
    ApiError.assert(res);
    return res.response.data.connected;
  },
  async assert({nodes, slot, store}) {
    const errors: AssertionResult[] = [];

    if (store[slot] < nodes.length - 1) {
      errors.push([
        "node has has low peer connections",
        {
          connections: store[slot],
          expectedConnections: nodes.length - 1,
        },
      ]);
    }

    return errors;
  },
};
