import bindings from "./bindings.js";

const native = bindings.executionBlockHash;

export const computeExecutionBlockHash = native.computeExecutionBlockHash;
export const computeTransactionsRoot = native.computeTransactionsRoot;
