import {describe, expect, it} from "vitest";
import {BitArray} from "@chainsafe/ssz";
import {ForkName, INCLUSION_LIST_COMMITTEE_SIZE} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {
  ExecutionPayloadBidError,
  ExecutionPayloadBidErrorCode,
  createExecutionPayloadBid,
} from "../../../src/services/executionPayloadBid.js";
import type {BuiltPayload} from "../../../src/services/payloadSource.js";

describe("createExecutionPayloadBid", () => {
  const slot = 10;
  const parentBlockRoot = Buffer.alloc(32, 1);
  const feeRecipient = Buffer.alloc(20, 2);
  const builderIndex = 7;

  it("constructs a Gloas bid from exact payload material", () => {
    const payload = createBuiltPayload(ForkName.gloas);
    payload.executionPayload.gasLimit = 30_000_000;
    payload.executionRequests.deposits.push(ssz.gloas.DepositRequest.defaultValue());

    const bid = createExecutionPayloadBid({
      fork: ForkName.gloas,
      slot,
      parentBlockRoot,
      builderIndex,
      feeRecipient,
      value: 123,
      payload,
    });

    expect(bid).toEqual({
      parentBlockHash: payload.executionPayload.parentHash,
      parentBlockRoot,
      blockHash: payload.executionPayload.blockHash,
      prevRandao: payload.executionPayload.prevRandao,
      feeRecipient,
      gasLimit: 30_000_000n,
      builderIndex,
      slot,
      value: 123,
      executionPayment: 0n,
      blobKzgCommitments: payload.blobsBundle.commitments,
      executionRequestsRoot: ssz.gloas.ExecutionRequests.hashTreeRoot(payload.executionRequests),
    });
  });

  it("requires and preserves Heze inclusion-list bits", () => {
    const payload = createBuiltPayload(ForkName.heze);
    const inclusionListBits = BitArray.fromBitLen(INCLUSION_LIST_COMMITTEE_SIZE);
    inclusionListBits.set(3, true);

    const bid = createExecutionPayloadBid({
      fork: ForkName.heze,
      slot,
      parentBlockRoot,
      builderIndex,
      feeRecipient,
      value: 456,
      payload,
      inclusionListBits,
    });

    expect(bid.inclusionListBits).toBe(inclusionListBits);
    expect(bid.executionRequestsRoot).toEqual(ssz.heze.ExecutionRequests.hashTreeRoot(payload.executionRequests));
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid bid value %s",
    (value) => {
      expect(() =>
        createExecutionPayloadBid({
          fork: ForkName.gloas,
          slot,
          parentBlockRoot,
          builderIndex,
          feeRecipient,
          value,
          payload: createBuiltPayload(ForkName.gloas),
        })
      ).toThrowError(
        new ExecutionPayloadBidError(
          {code: ExecutionPayloadBidErrorCode.INVALID_VALUE, value},
          `Invalid bid value value=${value}`
        )
      );
    }
  );

  it("rejects a runtime payload fork mismatch", () => {
    const payload = createBuiltPayload(ForkName.heze) as unknown as BuiltPayload<ForkName.gloas>;

    expect(() =>
      createExecutionPayloadBid({
        fork: ForkName.gloas,
        slot,
        parentBlockRoot,
        builderIndex,
        feeRecipient,
        value: 1,
        payload,
      })
    ).toThrowError(
      new ExecutionPayloadBidError(
        {code: ExecutionPayloadBidErrorCode.FORK_MISMATCH, fork: ForkName.gloas, payloadFork: ForkName.heze},
        `Payload fork does not match bid fork fork=${ForkName.gloas} payloadFork=${ForkName.heze}`
      )
    );
  });
});

function createBuiltPayload<F extends ForkName.gloas | ForkName.heze>(fork: F): BuiltPayload<F> {
  const forkTypes = fork === ForkName.heze ? ssz.heze : ssz.gloas;
  const executionPayload = forkTypes.ExecutionPayload.defaultValue();
  executionPayload.parentHash = Buffer.alloc(32, 3);
  executionPayload.blockHash = Buffer.alloc(32, 4);
  executionPayload.prevRandao = Buffer.alloc(32, 5);

  return {
    sourceId: "engine",
    fork,
    executionPayload,
    executionRequests: forkTypes.ExecutionRequests.defaultValue(),
    blobsBundle: forkTypes.BlobsBundle.defaultValue(),
    executionPayloadValue: 1n,
  } as BuiltPayload<F>;
}
