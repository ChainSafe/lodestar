import bindings from "./index.js";

export const ForkChoice = bindings.ForkChoice;

/** Spec `PayloadStatus`; a node id is `blockIndex * 3 + payloadStatus`. */
export const PayloadStatus = Object.freeze({Empty: 0, Full: 1, Pending: 2});

/** The engine's verdict on a payload, ordered so the worse status has the higher value. */
export const ExecutionStatus = Object.freeze({PreMerge: 0, Valid: 1, Syncing: 2, Invalid: 3});

/** Node id of no node, as reported by `bestChildren` and `latestMessages`. */
export const NO_NODE = 0xffffffff;

/** Block index of a block dropped by `prune`. */
export const NO_BLOCK = 0xffffffff;
