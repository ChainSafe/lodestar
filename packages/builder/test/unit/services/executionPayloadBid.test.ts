import {describe, expect, expectTypeOf, it} from "vitest";
import {BitArray} from "@chainsafe/ssz";
import {ForkName, type ForkPostGloas, INCLUSION_LIST_COMMITTEE_SIZE} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {
  ExecutionPayloadBidError,
  ExecutionPayloadBidErrorCode,
  type ExecutionPayloadBidInput,
  type HezeBidInput,
  createExecutionPayloadBid,
} from "../../../src/services/executionPayloadBid.js";
import type {BuiltPayload} from "../../../src/services/payloadSource.js";

describe("createExecutionPayloadBid", () => {
  const slot = 10;
  const parentBlockRoot = Buffer.alloc(32, 1);
  const feeRecipient = Buffer.alloc(20, 2);
  const builderIndex = 7;
  const prevRandao = Buffer.alloc(32, 5);

  it("constructs a Gloas bid from a built payload", () => {
    const payload = createBuiltPayload(ForkName.gloas);
    payload.executionPayload.gasLimit = 30_000_000;
    payload.executionRequests.deposits.push(ssz.gloas.DepositRequest.defaultValue());
    payload.blobsBundle.commitments.push(Buffer.alloc(48, 6));

    const bid = createExecutionPayloadBid({
      slot,
      parentBlockRoot,
      prevRandao,
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
      slot,
      parentBlockRoot,
      prevRandao,
      builderIndex,
      feeRecipient,
      value: 456,
      payload,
      inclusionListBits,
    });

    expect(bid.inclusionListBits).toBe(inclusionListBits);
    expect(bid.executionRequestsRoot).toEqual(ssz.heze.ExecutionRequests.hashTreeRoot(payload.executionRequests));
  });

  it.each([1, INCLUSION_LIST_COMMITTEE_SIZE - 1, INCLUSION_LIST_COMMITTEE_SIZE + 1, 24])(
    "rejects Heze inclusion-list bits with length %s",
    (bitLen) => {
      expect(() =>
        createExecutionPayloadBid({
          slot,
          parentBlockRoot,
          prevRandao,
          builderIndex,
          feeRecipient,
          value: 1,
          payload: createBuiltPayload(ForkName.heze),
          inclusionListBits: BitArray.fromBitLen(bitLen),
        })
      ).toThrowError(
        expect.objectContaining({
          type: {code: ExecutionPayloadBidErrorCode.INVALID_INCLUSION_LIST_BITS, bitLen},
        })
      );
    }
  );

  it.each([ForkName.gloas, ForkName.heze] as const)("rejects a %s payload with a different prevRandao", (fork) => {
    const payload = createBuiltPayload(fork);
    payload.executionPayload.prevRandao = Buffer.alloc(32, 6);
    const input = {
      slot,
      parentBlockRoot,
      prevRandao,
      builderIndex,
      feeRecipient,
      value: 1,
      payload,
    };

    expect(() =>
      fork === ForkName.heze
        ? createExecutionPayloadBid({
            ...input,
            payload: {...payload, fork: ForkName.heze},
            inclusionListBits: BitArray.fromBitLen(INCLUSION_LIST_COMMITTEE_SIZE),
          })
        : createExecutionPayloadBid({...input, payload: {...payload, fork: ForkName.gloas}})
    ).toThrowError(
      expect.objectContaining({
        type: {
          code: ExecutionPayloadBidErrorCode.PREV_RANDAO_MISMATCH,
          expectedPrevRandao: `0x${"05".repeat(32)}`,
          payloadPrevRandao: `0x${"06".repeat(32)}`,
        },
      })
    );
  });

  it.each([Number("0x20000000000001"), Number("0xffffffffffffffff")])(
    "rejects an inexact payload gas limit %s",
    (gasLimit) => {
      const payload = createBuiltPayload(ForkName.gloas);
      payload.executionPayload.gasLimit = gasLimit;
      expect(() =>
        createExecutionPayloadBid({
          slot,
          parentBlockRoot,
          prevRandao,
          builderIndex,
          feeRecipient,
          value: 1,
          payload,
        })
      ).toThrowError(expect.objectContaining({type: {code: ExecutionPayloadBidErrorCode.INVALID_GAS_LIMIT, gasLimit}}));
    }
  );

  it("preserves the maximum safely representable gas limit", () => {
    const payload = createBuiltPayload(ForkName.gloas);
    payload.executionPayload.gasLimit = Number.MAX_SAFE_INTEGER;
    const bid = createExecutionPayloadBid({
      slot,
      parentBlockRoot,
      prevRandao,
      builderIndex,
      feeRecipient,
      value: 1,
      payload,
    });
    expect(bid.gasLimit).toBe(BigInt(Number.MAX_SAFE_INTEGER));
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid bid value %s",
    (value) => {
      expect(() =>
        createExecutionPayloadBid({
          slot,
          parentBlockRoot,
          prevRandao,
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

  it("requires Heze bits in the input type", () => {
    expectTypeOf<HezeBidInput["inclusionListBits"]>().toEqualTypeOf<BitArray>();
    expectTypeOf<Omit<HezeBidInput, "inclusionListBits">>().not.toExtend<ExecutionPayloadBidInput>();
  });

  it.each([ForkName.gloas, ForkName.heze] as const)("accepts a union-typed %s input", (fork) => {
    const common = {slot, parentBlockRoot, prevRandao, builderIndex, feeRecipient, value: 1};
    const input: ExecutionPayloadBidInput =
      fork === ForkName.heze
        ? {
            ...common,
            payload: createBuiltPayload(ForkName.heze),
            inclusionListBits: BitArray.fromBitLen(INCLUSION_LIST_COMMITTEE_SIZE),
          }
        : {...common, payload: createBuiltPayload(ForkName.gloas)};

    const bid = createExecutionPayloadBid(input);
    expect("inclusionListBits" in bid).toBe(fork === ForkName.heze);
    expect(bid.blockHash).toEqual(input.payload.executionPayload.blockHash);
  });

  it.each(["slot", "parent"] as const)("rejects inconsistent payload %s before assembling a bid", (field) => {
    const payload = createBuiltPayload(ForkName.gloas);
    if (field === "slot") payload.executionPayload.slotNumber++;
    else payload.executionPayload.blockHash = payload.executionPayload.parentHash.slice();

    expect(() =>
      createExecutionPayloadBid({
        slot,
        parentBlockRoot,
        prevRandao,
        builderIndex,
        feeRecipient,
        value: 1,
        payload,
      })
    ).toThrowError(
      new ExecutionPayloadBidError(
        field === "slot"
          ? {code: ExecutionPayloadBidErrorCode.SLOT_MISMATCH, slot, payloadSlot: slot + 1}
          : {code: ExecutionPayloadBidErrorCode.BLOCK_HASH_EQUALS_PARENT}
      )
    );
  });
});

function createBuiltPayload<F extends ForkPostGloas>(fork: F): BuiltPayload & {fork: F} {
  const forkTypes = fork === ForkName.heze ? ssz.heze : ssz.gloas;
  const executionPayload = forkTypes.ExecutionPayload.defaultValue();
  executionPayload.slotNumber = 10;
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
  };
}
