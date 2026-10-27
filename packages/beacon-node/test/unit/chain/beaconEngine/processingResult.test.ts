import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {config} from "@lodestar/config/default";
import {ForkName} from "@lodestar/params";
import {phase0, ssz} from "@lodestar/types";
import {ErrorAborted, LodestarError, toRootHex} from "@lodestar/utils";
import {BeaconEngineMode} from "../../../../src/chain/beaconEngine/options.js";
import {blockFailureFromError, payloadFailureFromError} from "../../../../src/chain/beaconEngine/processingResult.js";
import {BlockInputPreData, BlockInputSource} from "../../../../src/chain/blocks/blockInput/index.js";
import {PayloadError, PayloadErrorCode} from "../../../../src/chain/blocks/payloadError.js";
import {computeSignedBlockRoot} from "../../../../src/chain/blocks/signedBlockRoot.js";
import {BlockError, BlockErrorCode, BlockErrorType} from "../../../../src/chain/errors/blockError.js";
import type {IBeaconEngine} from "../../../../src/chain/interface.js";
import {ExecutionPayloadStatus} from "../../../../src/execution/index.js";
import {MockedBeaconChain, getMockedBeaconChain, withBeaconEngineFacade} from "../../../mocks/mockedBeaconChain.js";

function createBlockInput(block: phase0.SignedBeaconBlock): BlockInputPreData {
  return BlockInputPreData.createFromBlock({
    block,
    blockRootHex: toRootHex(ssz.phase0.BeaconBlock.hashTreeRoot(block.message)),
    forkName: ForkName.phase0,
    source: BlockInputSource.api,
    seenTimestampSec: 0,
    daOutOfRange: false,
  });
}

describe("processing failure transport", () => {
  const blocks = [1, 2].map((slot) => {
    const block = ssz.phase0.SignedBeaconBlock.defaultValue();
    block.message.slot = slot;
    return block;
  });
  const roots = blocks.map((block) => ssz.phase0.BeaconBlock.hashTreeRoot(block.message));
  const signedRoots = blocks.map((block) => computeSignedBlockRoot(ForkName.phase0, block));
  const inputs = blocks.map(createBlockInput);
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

  describe.each([BeaconEngineMode.MainThread, BeaconEngineMode.Worker])("facade (%s)", (beaconEngineMode) => {
    let chain: MockedBeaconChain;
    let engine: IBeaconEngine;

    beforeEach(() => {
      chain = getMockedBeaconChain();
      chain.opts.beaconEngineMode = beaconEngineMode;
      engine = withBeaconEngineFacade(chain).beaconEngine;
    });

    afterEach(() => vi.restoreAllMocks());

    it.each(types)("rehydrates $code with the corresponding local block", async (type) => {
      const remoteBlock = ssz.phase0.SignedBeaconBlock.clone(blocks[1]);
      const original = new BlockError(remoteBlock, type);
      original.message = "verification failed";
      original.stack = "engine stack";
      const failure = structuredClone(blockFailureFromError(original, config, signedRoots));
      expect(failure).toMatchObject({blockIndex: 1, blockRoot: inputs[1].blockRootHex, message: original.message});
      expect(failure).not.toHaveProperty("signedBlock");
      vi.spyOn(
        chain.beaconEngine,
        beaconEngineMode === BeaconEngineMode.Worker ? "verifyBlocksBytes" : "verifyBlocks"
      ).mockResolvedValue({err: failure});
      const verification = engine.verifyBlocks(inputs, {});
      await expect(verification).rejects.toBeInstanceOf(BlockError);
      await verification.catch((error: BlockError) => {
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
    });

    it("rejects a mismatched input instead of blaming another block", async () => {
      const failure = blockFailureFromError(
        new BlockError(blocks[1], {code: BlockErrorCode.DATA_UNAVAILABLE}),
        config,
        signedRoots
      );
      vi.spyOn(chain.beaconEngine, beaconEngineMode === BeaconEngineMode.Worker ? "verifyBlocksBytes" : "verifyBlocks")
        .mockResolvedValueOnce({err: {...failure, blockIndex: 0}})
        .mockResolvedValueOnce({err: {...failure, blockIndex: 2}});
      await expect(engine.verifyBlocks(inputs, {})).rejects.toThrow("INVALID_BLOCK_FAILURE_CONTEXT");
      await expect(engine.verifyBlocks(inputs, {})).rejects.toThrow("INVALID_BLOCK_FAILURE_CONTEXT");
    });

    it("matches failures by signed candidate while preserving unsigned consensus error roots", async () => {
      const first = ssz.phase0.SignedBeaconBlock.clone(blocks[0]);
      const second = ssz.phase0.SignedBeaconBlock.clone(first);
      second.signature = Uint8Array.from(second.signature);
      second.signature[0] = 1;
      const failure = blockFailureFromError(
        new BlockError(second, {code: BlockErrorCode.INVALID_SIGNATURE, stateSlot: 1}),
        config,
        [computeSignedBlockRoot(ForkName.phase0, first), computeSignedBlockRoot(ForkName.phase0, second)]
      );

      expect(failure).toMatchObject({blockIndex: 1, blockRoot: toRootHex(roots[0])});
      vi.spyOn(
        chain.beaconEngine,
        beaconEngineMode === BeaconEngineMode.Worker ? "verifyBlocksBytes" : "verifyBlocks"
      ).mockResolvedValue({err: structuredClone(failure)});
      const verification = engine.verifyBlocks([first, second].map(createBlockInput), {});
      await expect(verification).rejects.toBeInstanceOf(BlockError);
      await verification.catch((error: BlockError) => {
        expect(error.signedBlock).toBe(second);
      });
    });
  });

  it.each([new Error("unexpected"), new ErrorAborted("shutdown")])("preserves unexpected exceptions: %s", (error) => {
    expect(() => blockFailureFromError(error, config, signedRoots)).toThrow(error);
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
