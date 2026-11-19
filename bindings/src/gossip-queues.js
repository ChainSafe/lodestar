import bindings from "./bindings.js";

export const gossipQueues = bindings.gossipQueues;

export const gossipDependencyDecision = Object.freeze({ready: 0, awaitBlock: 1, awaitPayload: 2, fatalPeer: 3});
