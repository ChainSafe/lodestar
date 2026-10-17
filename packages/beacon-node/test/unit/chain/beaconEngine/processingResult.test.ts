import {describe, expect, it} from "vitest";
import {config} from "@lodestar/config/default";
import {ssz} from "@lodestar/types";
import {ErrorAborted, LodestarError, toRootHex} from "@lodestar/utils";
import {
  blockErrorFromFailure,
  blockFailureFromError,
  payloadFailureFromError,
} from "../../../../src/chain/beaconEngine/processingResult.js";
import {PayloadError, PayloadErrorCode} from "../../../../src/chain/blocks/payloadError.js";
import {BlockError, BlockErrorCode, BlockErrorType} from "../../../../src/chain/errors/blockError.js";
import {ExecutionPayloadStatus} from "../../../../src/execution/index.js";

describe("processing failure transport", () => {
  const blocks = [1, 2].map((slot) => {
    const block = ssz.phase0.SignedBeaconBlock.defaultValue();
    block.message.slot = slot;
    return block;
  });
  const roots = blocks.map((block) => ssz.phase0.BeaconBlock.hashTreeRoot(block.message));
  const inputs = blocks.map((block, i) => ({blockRootHex: toRootHex(roots[i]), getBlock: () => block}));
  const cause = new Error("database read failed");
  const nested = new LodestarError({code: "REGEN_FAILED", slot: 2, root: roots[1], count: 4n});
  nested.cause = cause;
  const types: BlockErrorType[] = [
    {code: BlockErrorCode.PARENT_BLOCK_UNKNOWN, parentRoot: toRootHex(roots[0])},
    {code: BlockErrorCode.INVALID_SIGNATURE, stateSlot: 2},
    {code: BlockErrorCode.INVALID_STATE_ROOT, root: roots[0], expectedRoot: roots[1]},
    {code: BlockErrorCode.PRESTATE_MISSING, error: nested},
    {code: BlockErrorCode.PER_BLOCK_PROCESSING_ERROR, blockRoot: toRootHex(roots[1]), error: nested},
    {code: BlockErrorCode.BEACON_CHAIN_ERROR, error: nested},
    {
      code: BlockErrorCode.EXECUTION_ENGINE_INVALID,
      execStatus: ExecutionPayloadStatus.INVALID,
      errorMessage: "invalid",
    },
  ];

  it.each(types)("rehydrates $code with the corresponding local block", (type) => {
    const remoteBlock = ssz.phase0.SignedBeaconBlock.clone(blocks[1]);
    const original = new BlockError(remoteBlock, type);
    original.message = "verification failed";
    original.stack = "engine stack";
    const failure = structuredClone(blockFailureFromError(original, config, roots));
    expect(failure).toMatchObject({blockIndex: 1, blockRoot: inputs[1].blockRootHex, message: original.message});
    expect(failure).not.toHaveProperty("signedBlock");
    const error = blockErrorFromFailure(failure, inputs);
    expect(error).toBeInstanceOf(BlockError);
    expect(error.signedBlock).toBe(blocks[1]);
    expect(error.message).toBe(original.message);
    expect(error.stack).toBe(original.stack);
    expect(error.type).toMatchObject("error" in type ? {...type, error: expect.any(Error)} : type);
    if ("error" in type && "error" in error.type && "error" in failure.type) {
      expect(failure.type.error).not.toBeInstanceOf(Error);
      expect(error.type.error).toBeInstanceOf(Error);
      expect(error.type.error).toMatchObject({
        name: nested.name,
        type: nested.type,
        message: nested.message,
        stack: nested.stack,
      });
      expect(error.type.error.cause).toBeInstanceOf(Error);
      expect(error.type.error.cause).toMatchObject({message: cause.message, stack: cause.stack});
    }
  });

  it("rejects a mismatched input instead of blaming another block", () => {
    const failure = blockFailureFromError(
      new BlockError(blocks[1], {code: BlockErrorCode.DATA_UNAVAILABLE}),
      config,
      roots
    );
    expect(() => blockErrorFromFailure({...failure, blockIndex: 0}, inputs)).toThrow("INVALID_BLOCK_FAILURE_CONTEXT");
    expect(() => blockErrorFromFailure({...failure, blockIndex: 2}, inputs)).toThrow("INVALID_BLOCK_FAILURE_CONTEXT");
  });

  it.each([new Error("unexpected"), new ErrorAborted("shutdown")])("preserves unexpected exceptions: %s", (error) => {
    expect(() => blockFailureFromError(error, config, roots)).toThrow(error);
    expect(() => payloadFailureFromError(error)).toThrow(error);
  });

  it("preserves payload details and its custom message through structured clone", () => {
    const error = new PayloadError(
      {code: PayloadErrorCode.ENVELOPE_VERIFICATION_ERROR, message: "bad envelope"},
      "Envelope verification error: bad envelope"
    );
    const failure = structuredClone(payloadFailureFromError(error));
    expect(failure).toEqual({type: error.type, message: error.message, stack: error.stack});
    expect(failure).not.toBeInstanceOf(Error);
  });
});
