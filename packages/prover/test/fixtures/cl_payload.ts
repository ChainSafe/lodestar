import {allForks} from "@lodestar/types";

export const validExecutionPayload: allForks.ExecutionPayload = {
  blockHash: Buffer.alloc(32),
  stateRoot: Buffer.from("7c0f9a6f21d82c2d7690db7aa36c9938de11891071eed6e50ff8b06b5ae7018a", "hex"),
} as unknown as allForks.ExecutionPayload;

export const invalidExecutionPayload: allForks.ExecutionPayload = {
  blockHash: Buffer.alloc(32),
  stateRoot: Buffer.from("ac0d3a6f21d82c2d7690db7aa36c9938de11891071eed6e50ff8b06b5ae7018a", "hex"),
} as unknown as allForks.ExecutionPayload;
