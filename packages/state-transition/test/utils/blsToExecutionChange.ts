import {capella} from "@lodestar/types";

export function generateEmptyBlsToExecutionChange(): capella.BLSToExecutionChange {
  return {
    validatorIndex: 0,
    fromBlsPubkey: Buffer.alloc(48),
    toExecutionAddress: Buffer.alloc(20),
  };
}

export function generateEmptySignedBlsToExecutionChange(): capella.SignedBLSToExecutionChange {
  return {
    message: generateEmptyBlsToExecutionChange(),
    signature: Buffer.alloc(96),
  };
}
