import {BuilderIndex, RootHex, Slot} from "@lodestar/types";
import {GossipActionError} from "./gossipValidation.js";

export enum ExecutionPayloadBidErrorCode {
  BUILDER_NOT_ELIGIBLE = "EXECUTION_PAYLOAD_BID_ERROR_BUILDER_NOT_ELIGIBLE",
  INVALID_BUILDER_VERSION = "EXECUTION_PAYLOAD_BID_ERROR_INVALID_BUILDER_VERSION",
  NON_ZERO_EXECUTION_PAYMENT = "EXECUTION_PAYLOAD_BID_ERROR_NON_ZERO_EXECUTION_PAYMENT",
  BID_ALREADY_KNOWN = "EXECUTION_PAYLOAD_BID_ERROR_BID_ALREADY_KNOWN",
  BID_TOO_LOW = "EXECUTION_PAYLOAD_BID_ERROR_BID_TOO_LOW",
  BID_TOO_HIGH = "EXECUTION_PAYLOAD_BID_ERROR_BID_TOO_HIGH",
  TOO_MANY_KZG_COMMITMENTS = "EXECUTION_PAYLOAD_BID_ERROR_TOO_MANY_KZG_COMMITMENTS",
  UNKNOWN_BLOCK_ROOT = "EXECUTION_PAYLOAD_BID_ERROR_UNKNOWN_BLOCK_ROOT",
  UNKNOWN_PARENT_BLOCK_HASH = "EXECUTION_PAYLOAD_BID_ERROR_UNKNOWN_PARENT_BLOCK_HASH",
  INVALID_SLOT = "EXECUTION_PAYLOAD_BID_ERROR_INVALID_SLOT",
  NOT_LATER_THAN_PARENT = "EXECUTION_PAYLOAD_BID_ERROR_NOT_LATER_THAN_PARENT",
  INVALID_PREV_RANDAO = "EXECUTION_PAYLOAD_BID_ERROR_INVALID_PREV_RANDAO",
  INVALID_SIGNATURE = "EXECUTION_PAYLOAD_BID_ERROR_INVALID_SIGNATURE",
  NO_MATCHING_PROPOSER_PREFERENCES = "EXECUTION_PAYLOAD_BID_ERROR_NO_MATCHING_PROPOSER_PREFERENCES",
  PROPOSER_PREFERENCES_FEE_RECIPIENT_MISMATCH = "EXECUTION_PAYLOAD_BID_ERROR_PROPOSER_PREFERENCES_FEE_RECIPIENT_MISMATCH",
  PROPOSER_PREFERENCES_GAS_LIMIT_MISMATCH = "EXECUTION_PAYLOAD_BID_ERROR_PROPOSER_PREFERENCES_GAS_LIMIT_MISMATCH",
}

export type ExecutionPayloadBidErrorType =
  | {code: ExecutionPayloadBidErrorCode.BUILDER_NOT_ELIGIBLE; builderIndex: BuilderIndex}
  | {
      code: ExecutionPayloadBidErrorCode.INVALID_BUILDER_VERSION;
      builderIndex: BuilderIndex;
      version: number;
      expectedVersion: number;
    }
  | {
      code: ExecutionPayloadBidErrorCode.NON_ZERO_EXECUTION_PAYMENT;
      builderIndex: BuilderIndex;
      executionPayment: bigint;
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
  | {
      code: ExecutionPayloadBidErrorCode.TOO_MANY_KZG_COMMITMENTS;
      blobKzgCommitmentsLen: number;
      commitmentLimit: number;
    }
  | {code: ExecutionPayloadBidErrorCode.UNKNOWN_BLOCK_ROOT; parentBlockRoot: RootHex}
  | {code: ExecutionPayloadBidErrorCode.UNKNOWN_PARENT_BLOCK_HASH; parentBlockHash: RootHex}
  | {code: ExecutionPayloadBidErrorCode.INVALID_SLOT; builderIndex: BuilderIndex; slot: Slot}
  | {code: ExecutionPayloadBidErrorCode.NOT_LATER_THAN_PARENT; parentSlot: Slot; slot: Slot}
  | {
      code: ExecutionPayloadBidErrorCode.INVALID_PREV_RANDAO;
      builderIndex: BuilderIndex;
      bidPrevRandao: string;
      expectedPrevRandao: string;
    }
  | {code: ExecutionPayloadBidErrorCode.INVALID_SIGNATURE; builderIndex: BuilderIndex; slot: Slot}
  | {
      code: ExecutionPayloadBidErrorCode.NO_MATCHING_PROPOSER_PREFERENCES;
      slot: Slot;
      parentBlockRoot: RootHex;
      dependentRoot: RootHex;
    }
  | {
      code: ExecutionPayloadBidErrorCode.PROPOSER_PREFERENCES_FEE_RECIPIENT_MISMATCH;
      builderIndex: BuilderIndex;
      bidFeeRecipient: string;
      expectedFeeRecipient: string;
    }
  | {
      code: ExecutionPayloadBidErrorCode.PROPOSER_PREFERENCES_GAS_LIMIT_MISMATCH;
      builderIndex: BuilderIndex;
      bidGasLimit: number;
      parentGasLimit: number;
      targetGasLimit: number;
    };

export class ExecutionPayloadBidError extends GossipActionError<ExecutionPayloadBidErrorType> {}
