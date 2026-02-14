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

    // Allow one missing peer connection to account for transient disconnects on CI.
    // With N nodes, expect at least N-2 connections instead of N-1.
    // For single-node setups (e.g. endpoint sim), expect 0 peers.
    const minExpectedConnections = nodes.length <= 1 ? 0 : nodes.length - 2;
    if (store[slot] < minExpectedConnections) {
      errors.push([
        "node has has low peer connections",
        {
          connections: store[slot],
          expectedConnections: minExpectedConnections,
        },
      ]);
    }

    return errors;
  },
};
