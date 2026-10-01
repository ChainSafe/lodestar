import {ForkName, type ForkPostGloas, INCLUSION_LIST_COMMITTEE_SIZE} from "@lodestar/params";
import type {
  BuilderIndex,
  Bytes32,
  ExecutionAddress,
  ExecutionPayloadBid,
  Root,
  RootHex,
  Slot,
  gloas,
  heze,
} from "@lodestar/types";
import {sszTypesFor} from "@lodestar/types";
import {LodestarError, byteArrayEquals, toRootHex} from "@lodestar/utils";
import type {BuiltPayload} from "./payloadSource.js";

type CommonBidInput<F extends ForkPostGloas> = {
  slot: Slot;
  parentBlockRoot: Root;
  /** Expected value from the BN payload attributes used for this build. */
  prevRandao: Bytes32;
  builderIndex: BuilderIndex;
  feeRecipient: ExecutionAddress;
  /** Bid value in gwei */
  value: number;
  payload: BuiltPayload & {fork: F};
};

export type GloasBidInput = CommonBidInput<ForkName.gloas>;

export type HezeBidInput = CommonBidInput<ForkName.heze> & {
  inclusionListBits: heze.ExecutionPayloadBid["inclusionListBits"];
};

export type ExecutionPayloadBidInput = GloasBidInput | HezeBidInput;

export enum ExecutionPayloadBidErrorCode {
  INVALID_VALUE = "EXECUTION_PAYLOAD_BID_ERROR_INVALID_VALUE",
  INVALID_GAS_LIMIT = "EXECUTION_PAYLOAD_BID_ERROR_INVALID_GAS_LIMIT",
  SLOT_MISMATCH = "EXECUTION_PAYLOAD_BID_ERROR_SLOT_MISMATCH",
  BLOCK_HASH_EQUALS_PARENT = "EXECUTION_PAYLOAD_BID_ERROR_BLOCK_HASH_EQUALS_PARENT",
  INVALID_INCLUSION_LIST_BITS = "EXECUTION_PAYLOAD_BID_ERROR_INVALID_INCLUSION_LIST_BITS",
  PREV_RANDAO_MISMATCH = "EXECUTION_PAYLOAD_BID_ERROR_PREV_RANDAO_MISMATCH",
}

export type ExecutionPayloadBidErrorType =
  | {code: ExecutionPayloadBidErrorCode.INVALID_GAS_LIMIT; gasLimit: number}
  | {code: ExecutionPayloadBidErrorCode.SLOT_MISMATCH; slot: Slot; payloadSlot: Slot}
  | {code: ExecutionPayloadBidErrorCode.BLOCK_HASH_EQUALS_PARENT}
  | {code: ExecutionPayloadBidErrorCode.INVALID_INCLUSION_LIST_BITS; bitLen: number | undefined}
  | {
      code: ExecutionPayloadBidErrorCode.PREV_RANDAO_MISMATCH;
      expectedPrevRandao: RootHex;
      payloadPrevRandao: RootHex;
    }
  | {
      code: ExecutionPayloadBidErrorCode.INVALID_VALUE;
      value: number;
    };

export class ExecutionPayloadBidError extends LodestarError<ExecutionPayloadBidErrorType> {}

export function createExecutionPayloadBid(input: GloasBidInput): gloas.ExecutionPayloadBid;
export function createExecutionPayloadBid(input: HezeBidInput): heze.ExecutionPayloadBid;
export function createExecutionPayloadBid(input: ExecutionPayloadBidInput): ExecutionPayloadBid;
export function createExecutionPayloadBid(input: ExecutionPayloadBidInput): ExecutionPayloadBid {
  if (!Number.isSafeInteger(input.value) || input.value < 0) {
    throw new ExecutionPayloadBidError(
      {code: ExecutionPayloadBidErrorCode.INVALID_VALUE, value: input.value},
      `Invalid bid value value=${input.value}`
    );
  }

  const {fork, executionPayload, executionRequests, blobsBundle} = input.payload;
  if (executionPayload.gasLimit > Number.MAX_SAFE_INTEGER) {
    throw new ExecutionPayloadBidError({
      code: ExecutionPayloadBidErrorCode.INVALID_GAS_LIMIT,
      gasLimit: executionPayload.gasLimit,
    });
  }
  if (executionPayload.slotNumber !== input.slot) {
    throw new ExecutionPayloadBidError({
      code: ExecutionPayloadBidErrorCode.SLOT_MISMATCH,
      slot: input.slot,
      payloadSlot: executionPayload.slotNumber,
    });
  }
  if (byteArrayEquals(executionPayload.blockHash, executionPayload.parentHash)) {
    throw new ExecutionPayloadBidError({code: ExecutionPayloadBidErrorCode.BLOCK_HASH_EQUALS_PARENT});
  }
  if (!byteArrayEquals(executionPayload.prevRandao, input.prevRandao)) {
    throw new ExecutionPayloadBidError({
      code: ExecutionPayloadBidErrorCode.PREV_RANDAO_MISMATCH,
      expectedPrevRandao: toRootHex(input.prevRandao),
      payloadPrevRandao: toRootHex(executionPayload.prevRandao),
    });
  }
  const bid: gloas.ExecutionPayloadBid = {
    parentBlockHash: executionPayload.parentHash,
    parentBlockRoot: input.parentBlockRoot,
    blockHash: executionPayload.blockHash,
    prevRandao: input.prevRandao,
    feeRecipient: input.feeRecipient,
    gasLimit: BigInt(executionPayload.gasLimit),
    builderIndex: input.builderIndex,
    slot: input.slot,
    value: input.value,
    executionPayment: 0n,
    blobKzgCommitments: blobsBundle.commitments,
    executionRequestsRoot: sszTypesFor(fork).ExecutionRequests.hashTreeRoot(executionRequests),
  };

  if (fork === ForkName.heze) {
    const inclusionListBits = "inclusionListBits" in input ? input.inclusionListBits : undefined;
    if (inclusionListBits?.bitLen !== INCLUSION_LIST_COMMITTEE_SIZE) {
      throw new ExecutionPayloadBidError({
        code: ExecutionPayloadBidErrorCode.INVALID_INCLUSION_LIST_BITS,
        bitLen: inclusionListBits?.bitLen,
      });
    }
    return {...bid, inclusionListBits};
  }

  return bid;
}
