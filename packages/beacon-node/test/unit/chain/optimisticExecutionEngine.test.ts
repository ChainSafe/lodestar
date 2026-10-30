import {describe, expect, it, vi} from "vitest";
import {ExecutionStatus, IForkChoice, LVHInvalidResponse, ProtoBlock} from "@lodestar/fork-choice";
import {testLogger} from "@lodestar/logger/test-utils";
import {ForkName} from "@lodestar/params";
import {ExecutionInvalidSource} from "../../../src/chain/forkChoice/index.js";
import {OptimisticExecutionEngine} from "../../../src/chain/optimisticExecutionEngine.js";
import {
  ExecutionPayloadStatus,
  ForkchoiceUpdatedResult,
  IExecutionEngine,
  PayloadAttributes,
} from "../../../src/execution/index.js";

describe("OptimisticExecutionEngine", () => {
  const logger = testLogger("optimisticExecutionEngine");
  const fork = ForkName.fulu;
  const headBlockRoot = "0x" + "aa".repeat(32);
  const headBlockHash = "0x" + "bb".repeat(32);
  const safeBlockHash = "0x" + "cc".repeat(32);
  const finalizedBlockHash = "0x" + "dd".repeat(32);
  const latestValidHash = "0x" + "ee".repeat(32);
  const payloadId = "0x0102030405060708";
  const payloadAttributes = {} as PayloadAttributes;

  function setup(headExecutionStatus: ExecutionStatus | null, result: ForkchoiceUpdatedResult) {
    const notifyForkchoiceUpdate = vi.fn().mockResolvedValue(result);
    const getBlockHexAndBlockHash = vi
      .fn()
      .mockReturnValue(headExecutionStatus === null ? null : ({executionStatus: headExecutionStatus} as ProtoBlock));
    const validateLatestHash = vi.fn().mockReturnValue(true);
    const recomputeHeadAfterELInvalidResponse = vi.fn();

    const engine = new OptimisticExecutionEngine({notifyForkchoiceUpdate} as unknown as IExecutionEngine, {
      forkChoice: {getBlockHexAndBlockHash, validateLatestHash} as unknown as IForkChoice,
      recomputeHeadAfterELInvalidResponse,
      logger,
      metrics: null,
    });
    return {
      engine,
      notifyForkchoiceUpdate,
      getBlockHexAndBlockHash,
      validateLatestHash,
      recomputeHeadAfterELInvalidResponse,
    };
  }

  function fcuResult(status: ExecutionPayloadStatus, lvh: string | null = null): ForkchoiceUpdatedResult {
    return {
      payloadStatus: {status, latestValidHash: lvh, validationError: null},
      payloadId: status === ExecutionPayloadStatus.INVALID ? null : payloadId,
    } as ForkchoiceUpdatedResult;
  }

  function notifyFcu(engine: OptimisticExecutionEngine, attrs?: PayloadAttributes) {
    return engine.notifyForkchoiceUpdate(fork, headBlockRoot, headBlockHash, safeBlockHash, finalizedBlockHash, attrs);
  }

  const invalidLvh: LVHInvalidResponse = {
    executionStatus: ExecutionStatus.Invalid,
    latestValidExecHash: latestValidHash,
    invalidateFromParentBlockRoot: headBlockRoot,
    invalidateFromParentBlockHash: headBlockHash,
  };

  describe("notifyForkchoiceUpdate", () => {
    it("forwards hashes to the engine and looks up the exact head node", async () => {
      const {engine, notifyForkchoiceUpdate, getBlockHexAndBlockHash} = setup(
        ExecutionStatus.Valid,
        fcuResult(ExecutionPayloadStatus.VALID)
      );

      await notifyFcu(engine, payloadAttributes);

      expect(notifyForkchoiceUpdate).toHaveBeenCalledWith(
        fork,
        headBlockHash,
        safeBlockHash,
        finalizedBlockHash,
        payloadAttributes
      );
      expect(getBlockHexAndBlockHash).toHaveBeenCalledWith(headBlockRoot, headBlockHash);
    });

    it("VALID on a syncing head validates it leniently", async () => {
      const {engine, validateLatestHash, recomputeHeadAfterELInvalidResponse} = setup(
        ExecutionStatus.Syncing,
        fcuResult(ExecutionPayloadStatus.VALID)
      );

      expect(await notifyFcu(engine)).toBe(payloadId);
      expect(validateLatestHash).toHaveBeenCalledWith(
        {executionStatus: ExecutionStatus.Valid, latestValidExecHash: headBlockHash, blockRoot: headBlockRoot},
        {strict: false}
      );
      expect(recomputeHeadAfterELInvalidResponse).not.toHaveBeenCalled();
    });

    const noopCases: [string, ExecutionStatus | null, ExecutionPayloadStatus][] = [
      ["VALID on an already valid head", ExecutionStatus.Valid, ExecutionPayloadStatus.VALID],
      ["VALID on an unknown head", null, ExecutionPayloadStatus.VALID],
      ["SYNCING on a syncing head", ExecutionStatus.Syncing, ExecutionPayloadStatus.SYNCING],
      ["ACCEPTED on a syncing head", ExecutionStatus.Syncing, ExecutionPayloadStatus.ACCEPTED],
    ];
    for (const [name, headStatus, status] of noopCases) {
      it(`${name} does not touch fork choice`, async () => {
        const {engine, validateLatestHash} = setup(headStatus, fcuResult(status));

        expect(await notifyFcu(engine)).toBe(payloadId);
        expect(validateLatestHash).not.toHaveBeenCalled();
      });
    }

    it("INVALID without payload attributes invalidates, recomputes head and returns null", async () => {
      const {engine, validateLatestHash, recomputeHeadAfterELInvalidResponse} = setup(
        ExecutionStatus.Syncing,
        fcuResult(ExecutionPayloadStatus.INVALID, latestValidHash)
      );

      expect(await notifyFcu(engine)).toBeNull();
      expect(validateLatestHash).toHaveBeenCalledWith(invalidLvh, {strict: false});
      expect(recomputeHeadAfterELInvalidResponse).toHaveBeenCalledOnce();
    });

    it("INVALID with payload attributes invalidates then throws", async () => {
      const {engine, validateLatestHash, recomputeHeadAfterELInvalidResponse} = setup(
        ExecutionStatus.Syncing,
        fcuResult(ExecutionPayloadStatus.INVALID, latestValidHash)
      );

      await expect(notifyFcu(engine, payloadAttributes)).rejects.toThrow("Invalid prepare payload");
      expect(validateLatestHash).toHaveBeenCalledWith(invalidLvh, {strict: false});
      expect(recomputeHeadAfterELInvalidResponse).toHaveBeenCalledOnce();
    });

    it("INVALID on an already invalid head is a no-op", async () => {
      const {engine, validateLatestHash, recomputeHeadAfterELInvalidResponse} = setup(
        ExecutionStatus.Invalid,
        fcuResult(ExecutionPayloadStatus.INVALID, latestValidHash)
      );

      expect(await notifyFcu(engine)).toBeNull();
      expect(validateLatestHash).not.toHaveBeenCalled();
      expect(recomputeHeadAfterELInvalidResponse).not.toHaveBeenCalled();
    });

    it("swallows fork choice errors while applying the verdict", async () => {
      const {engine, validateLatestHash} = setup(ExecutionStatus.Syncing, fcuResult(ExecutionPayloadStatus.VALID));
      validateLatestHash.mockImplementation(() => {
        throw Error("fork choice error");
      });

      expect(await notifyFcu(engine)).toBe(payloadId);
    });
  });

  describe("invalidateExecutionPayloads", () => {
    const strictCases: [ExecutionInvalidSource, boolean][] = [
      [ExecutionInvalidSource.blockSegment, true],
      [ExecutionInvalidSource.newPayload, false],
      [ExecutionInvalidSource.forkchoiceUpdated, false],
    ];
    for (const [source, strict] of strictCases) {
      it(`source=${source} applies with strict=${strict} and recomputes head`, () => {
        const {engine, validateLatestHash, recomputeHeadAfterELInvalidResponse} = setup(
          ExecutionStatus.Syncing,
          fcuResult(ExecutionPayloadStatus.VALID)
        );

        engine.invalidateExecutionPayloads(invalidLvh, source);

        expect(validateLatestHash).toHaveBeenCalledWith(invalidLvh, {strict});
        expect(recomputeHeadAfterELInvalidResponse).toHaveBeenCalledOnce();
      });
    }

    it("does not recompute head when fork choice does not apply the verdict", () => {
      const {engine, validateLatestHash, recomputeHeadAfterELInvalidResponse} = setup(
        ExecutionStatus.Syncing,
        fcuResult(ExecutionPayloadStatus.VALID)
      );
      validateLatestHash.mockReturnValue(false);

      engine.invalidateExecutionPayloads(invalidLvh, ExecutionInvalidSource.newPayload);

      expect(recomputeHeadAfterELInvalidResponse).not.toHaveBeenCalled();
    });

    it("swallows head recompute errors", () => {
      const {engine, recomputeHeadAfterELInvalidResponse} = setup(
        ExecutionStatus.Syncing,
        fcuResult(ExecutionPayloadStatus.VALID)
      );
      recomputeHeadAfterELInvalidResponse.mockImplementation(() => {
        throw Error("recompute error");
      });

      expect(() => engine.invalidateExecutionPayloads(invalidLvh, ExecutionInvalidSource.newPayload)).not.toThrow();
      expect(recomputeHeadAfterELInvalidResponse).toHaveBeenCalledOnce();
    });
  });
});
