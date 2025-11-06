import { RootHex, Slot, ValidatorIndex } from "@lodestar/types";
import {GossipActionError} from "./gossipValidation.ts";

export enum ExecutionPayloadBidErrorCode {
  BUILDER_NOT_ELIGIBLE = "EXECUTION_PAYLOAD_BID_ERROR_BUILDER_NOT_ELIGIBLE",
  BUILDER_BAD_CREDENTIALS = "EXECUTION_PAYLOAD_BID_ERROR_BUILDER_BAD_CREDENTIALS",
  BID_ALREADY_KNOWN = "EXECUTION_PAYLOAD_BID_ERROR_BID_ALREADY_KNOWN",
  BID_TOO_LOW = "EXECUTION_PAYLOAD_BID_ERROR_BID_TOO_LOW",
  BID_TOO_HIGH = "EXECUTION_PAYLOAD_BID_ERROR_BID_TOO_HIGH",
  UNKNOWN_PARENT_BLOCK_HASH = "EXECUTION_PAYLOAD_BID_ERROR_UNKNOWN_PARENT_BLOCK_HASH",
  UNKNWON_BLOCK_ROOT = "EXECUTION_PAYLOAD_BID_ERROR_UNKNWON_BLOCK_ROOT",
  INVALID_SLOT = "EXECUTION_PAYLOAD_BID_ERROR_INVALID_SLOT",
  INVALID_SIGNATURE = "EXECUTION_PAYLOAD_BID_ERROR_INVALID_SIGNATURE",
}

export type ExecutionPayloadBidErrorType =
  | {code: ExecutionPayloadBidErrorCode.BUILDER_NOT_ELIGIBLE; builderIndex: ValidatorIndex}
  | {code: ExecutionPayloadBidErrorCode.BUILDER_BAD_CREDENTIALS; builderIndex: ValidatorIndex}
  | {code: ExecutionPayloadBidErrorCode.BID_ALREADY_KNOWN; builderIndex: ValidatorIndex; slot: Slot; parentBlockRoot: RootHex, parentBlockHash: RootHex}
  | {code: ExecutionPayloadBidErrorCode.BID_TOO_LOW; bidValue: bigint; currentHighestBid: bigint}
  | {code: ExecutionPayloadBidErrorCode.BID_TOO_HIGH; bidValue: bigint; builderBalance: bigint}
  | {code: ExecutionPayloadBidErrorCode.UNKNOWN_PARENT_BLOCK_HASH; parentBlockHash: RootHex}
  | {code: ExecutionPayloadBidErrorCode.UNKNWON_BLOCK_ROOT; parentBlockRoot: RootHex}
  | {code: ExecutionPayloadBidErrorCode.INVALID_SLOT; slot: Slot}
  | {code: ExecutionPayloadBidErrorCode.INVALID_SIGNATURE};


export class ExecutionPayloadBidError extends GossipActionError<ExecutionPayloadBidErrorType> {}
