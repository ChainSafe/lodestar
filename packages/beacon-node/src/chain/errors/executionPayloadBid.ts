import {BuilderIndex, RootHex, Slot} from "@lodestar/types";
import {GossipActionError} from "./gossipValidation.ts";

export enum ExecutionPayloadBidErrorCode {
  BUILDER_NOT_ELIGIBLE = "EXECUTION_PAYLOAD_BID_ERROR_BUILDER_NOT_ELIGIBLE",
  NON_ZERO_EXECUTION_PAYMENT = "EXECUTION_PAYLOAD_BID_ERROR_NON_ZERO_EXECUTION_PAYMENT",
  BID_ALREADY_KNOWN = "EXECUTION_PAYLOAD_BID_ERROR_BID_ALREADY_KNOWN",
  BID_TOO_LOW = "EXECUTION_PAYLOAD_BID_ERROR_BID_TOO_LOW",
  BID_TOO_HIGH = "EXECUTION_PAYLOAD_BID_ERROR_BID_TOO_HIGH",
  UNKNOWN_BLOCK_ROOT = "EXECUTION_PAYLOAD_BID_ERROR_UNKNOWN_BLOCK_ROOT",
  INVALID_SLOT = "EXECUTION_PAYLOAD_BID_ERROR_INVALID_SLOT",
  INVALID_SIGNATURE = "EXECUTION_PAYLOAD_BID_ERROR_INVALID_SIGNATURE",
}

export type ExecutionPayloadBidErrorType =
  | {code: ExecutionPayloadBidErrorCode.BUILDER_NOT_ELIGIBLE; builderIndex: BuilderIndex}
  | {
      code: ExecutionPayloadBidErrorCode.NON_ZERO_EXECUTION_PAYMENT;
      builderIndex: BuilderIndex;
      executionPayment: number;
    }
  | {
      code: ExecutionPayloadBidErrorCode.BID_ALREADY_KNOWN;
      builderIndex: BuilderIndex;
      slot: Slot;
      parentBlockRoot: RootHex;
      parentBlockHash: RootHex;
    }
  | {code: ExecutionPayloadBidErrorCode.BID_TOO_LOW; bidValue: number; currentHighestBid: number}
  | {code: ExecutionPayloadBidErrorCode.BID_TOO_HIGH; bidValue: number; builderBalance: number}
  | {code: ExecutionPayloadBidErrorCode.UNKNOWN_BLOCK_ROOT; parentBlockRoot: RootHex}
  | {code: ExecutionPayloadBidErrorCode.INVALID_SLOT; builderIndex: BuilderIndex; slot: Slot}
  | {code: ExecutionPayloadBidErrorCode.INVALID_SIGNATURE; builderIndex: BuilderIndex; slot: Slot};

export class ExecutionPayloadBidError extends GossipActionError<ExecutionPayloadBidErrorType> {}
