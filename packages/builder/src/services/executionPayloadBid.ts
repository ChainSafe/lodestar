import {ForkName} from "@lodestar/params";
import type {BuilderIndex, ExecutionAddress, ExecutionPayloadBid, Root, Slot, gloas, heze} from "@lodestar/types";
import {ssz} from "@lodestar/types";
import {LodestarError} from "@lodestar/utils";
import type {BuiltPayload} from "./payloadSource.js";

type CommonBidInput<F extends ForkName.gloas | ForkName.heze> = {
  fork: F;
  slot: Slot;
  parentBlockRoot: Root;
  builderIndex: BuilderIndex;
  feeRecipient: ExecutionAddress;
  value: number;
  payload: BuiltPayload<F>;
};

export type GloasBidInput = CommonBidInput<ForkName.gloas>;

export type HezeBidInput = CommonBidInput<ForkName.heze> & {
  inclusionListBits: heze.ExecutionPayloadBid["inclusionListBits"];
};

export type ExecutionPayloadBidInput = GloasBidInput | HezeBidInput;

export enum ExecutionPayloadBidErrorCode {
  FORK_MISMATCH = "EXECUTION_PAYLOAD_BID_ERROR_FORK_MISMATCH",
  INVALID_VALUE = "EXECUTION_PAYLOAD_BID_ERROR_INVALID_VALUE",
}

export type ExecutionPayloadBidErrorType =
  | {
      code: ExecutionPayloadBidErrorCode.FORK_MISMATCH;
      fork: ForkName.gloas | ForkName.heze;
      payloadFork: ForkName.gloas | ForkName.heze;
    }
  | {
      code: ExecutionPayloadBidErrorCode.INVALID_VALUE;
      value: number;
    };

export class ExecutionPayloadBidError extends LodestarError<ExecutionPayloadBidErrorType> {}

export function createExecutionPayloadBid(input: GloasBidInput): gloas.ExecutionPayloadBid;
export function createExecutionPayloadBid(input: HezeBidInput): heze.ExecutionPayloadBid;
export function createExecutionPayloadBid(input: ExecutionPayloadBidInput): ExecutionPayloadBid {
  if (input.payload.fork !== input.fork) {
    throw new ExecutionPayloadBidError(
      {code: ExecutionPayloadBidErrorCode.FORK_MISMATCH, fork: input.fork, payloadFork: input.payload.fork},
      `Payload fork does not match bid fork fork=${input.fork} payloadFork=${input.payload.fork}`
    );
  }

  if (!Number.isSafeInteger(input.value) || input.value < 0) {
    throw new ExecutionPayloadBidError(
      {code: ExecutionPayloadBidErrorCode.INVALID_VALUE, value: input.value},
      `Invalid bid value value=${input.value}`
    );
  }

  const {executionPayload, executionRequests, blobsBundle} = input.payload;
  const bid: gloas.ExecutionPayloadBid = {
    parentBlockHash: executionPayload.parentHash,
    parentBlockRoot: input.parentBlockRoot,
    blockHash: executionPayload.blockHash,
    prevRandao: executionPayload.prevRandao,
    feeRecipient: input.feeRecipient,
    gasLimit: BigInt(executionPayload.gasLimit),
    builderIndex: input.builderIndex,
    slot: input.slot,
    value: input.value,
    executionPayment: 0n,
    blobKzgCommitments: blobsBundle.commitments,
    executionRequestsRoot:
      input.fork === ForkName.heze
        ? ssz.heze.ExecutionRequests.hashTreeRoot(executionRequests)
        : ssz.gloas.ExecutionRequests.hashTreeRoot(executionRequests),
  };

  if (input.fork === ForkName.heze) {
    return {...bid, inclusionListBits: input.inclusionListBits};
  }

  return bid;
}
