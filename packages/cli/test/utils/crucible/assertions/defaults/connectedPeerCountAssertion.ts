import {Assertion, AssertionResult} from "../../interfaces.js";
import {everySlotMatcher} from "../matchers.js";

export const connectedPeerCountAssertion: Assertion<"connectedPeerCount", number> = {
  id: "connectedPeerCount",
  match: everySlotMatcher,
  async capture({node}) {
    return (await node.beacon.api.node.getPeerCount()).value().connected;
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
