import {type Mock, beforeEach, describe, expect, it, vi} from "vitest";
import {ForkName, type ForkPostGloas} from "@lodestar/params";
import {type ColumnIndex, type RootHex, ssz} from "@lodestar/types";
import {ErrorAborted, TimeoutError, toRootHex} from "@lodestar/utils";
import {
  BuildHandle,
  BuildRequest,
  EnginePayloadResult,
  EnginePayloadSource,
  PayloadAttributes,
  PayloadId,
  PayloadSourceEngine,
  PayloadSourceError,
  PayloadSourceErrorCode,
} from "../../../src/services/payloadSource.js";

describe("EnginePayloadSource", () => {
  const sourceId = "engine-0";
  const payloadId = "0x0102030405060708";
  const forkchoiceState = {
    headBlockHash: toRootHex(Uint8Array.from({length: 32}, () => 1)),
    safeBlockHash: toRootHex(Uint8Array.from({length: 32}, () => 2)),
    finalizedBlockHash: toRootHex(Uint8Array.from({length: 32}, () => 3)),
  };
  const payloadAttributes = ssz.gloas.PayloadAttributes.defaultValue();
  const custodyColumns = [0, 3, 127];
  const request: BuildRequest<ForkName.gloas> = {
    fork: ForkName.gloas,
    forkchoiceState,
    payloadAttributes,
    custodyColumns,
  };

  // @ts-expect-error Heze requests cannot use Gloas payload attributes.
  const mismatchedRequest: BuildRequest = {...request, fork: ForkName.heze};
  void mismatchedRequest;

  const handle: BuildHandle<ForkName.gloas> = {sourceId, fork: ForkName.gloas, payloadId};
  const signal = new AbortController().signal;

  let notifyForkchoiceUpdate: Mock<NotifyForkchoiceUpdate>;
  let getPayload: Mock<GetPayload>;
  let source: EnginePayloadSource;

  beforeEach(() => {
    notifyForkchoiceUpdate = vi.fn();
    getPayload = vi.fn();
    const engine = {notifyForkchoiceUpdate, getPayload} as unknown as PayloadSourceEngine;
    source = new EnginePayloadSource(sourceId, engine);
  });

  it("prepares a payload and returns a source-bound handle", async () => {
    notifyForkchoiceUpdate.mockResolvedValue(payloadId);

    const result = await source.prepare(request, signal);

    expect(notifyForkchoiceUpdate).toHaveBeenCalledWith(
      ForkName.gloas,
      forkchoiceState.headBlockHash,
      forkchoiceState.safeBlockHash,
      forkchoiceState.finalizedBlockHash,
      payloadAttributes,
      custodyColumns,
      signal
    );
    expect(result).toEqual(handle);
  });

  it("preserves a null custody set", async () => {
    notifyForkchoiceUpdate.mockResolvedValue(payloadId);

    await source.prepare({...request, custodyColumns: null}, signal);

    expect(notifyForkchoiceUpdate).toHaveBeenCalledWith(
      ForkName.gloas,
      forkchoiceState.headBlockHash,
      forkchoiceState.safeBlockHash,
      forkchoiceState.finalizedBlockHash,
      payloadAttributes,
      null,
      signal
    );
  });

  it("supports post-Gloas forks without narrowing the fork", async () => {
    const hezePayloadAttributes = ssz.heze.PayloadAttributes.defaultValue();
    hezePayloadAttributes.inclusionListTransactions = [Uint8Array.from([1, 2, 3])];
    notifyForkchoiceUpdate.mockResolvedValue(payloadId);
    getPayload.mockResolvedValue({
      executionPayload: ssz.heze.ExecutionPayload.defaultValue(),
      blobsBundle: ssz.heze.BlobsBundle.defaultValue(),
      executionRequests: ssz.heze.ExecutionRequests.defaultValue(),
      executionPayloadValue: 12_345_678_901_234_567_890n,
    });

    const result = await source.prepare(
      {
        fork: ForkName.heze,
        forkchoiceState,
        payloadAttributes: hezePayloadAttributes,
        custodyColumns,
      },
      signal
    );
    const builtPayload = await source.getPayload(result, signal);

    expect(result.fork).toBe(ForkName.heze);
    expect(notifyForkchoiceUpdate).toHaveBeenCalledWith(
      ForkName.heze,
      forkchoiceState.headBlockHash,
      forkchoiceState.safeBlockHash,
      forkchoiceState.finalizedBlockHash,
      hezePayloadAttributes,
      custodyColumns,
      signal
    );
    expect(getPayload).toHaveBeenCalledWith(ForkName.heze, payloadId, signal);
    expect(builtPayload.fork).toBe(ForkName.heze);
    expect(hezePayloadAttributes.inclusionListTransactions).toHaveLength(1);
  });

  it("rejects a missing payload ID with a structured error", async () => {
    notifyForkchoiceUpdate.mockResolvedValue(null);

    const error = await getPayloadSourceError(source.prepare(request, signal));

    expect(error.type).toEqual({code: PayloadSourceErrorCode.NO_PAYLOAD_ID, sourceId});
  });

  it.each([
    ["transport", new Error("connection reset")],
    ["unsupported Engine response", new Error("Method not found")],
    ["timeout", new TimeoutError("engine_forkchoiceUpdatedV4")],
    ["cancellation", new ErrorAborted("engine_forkchoiceUpdatedV4")],
  ])("propagates %s errors from payload preparation", async (_name, error) => {
    notifyForkchoiceUpdate.mockRejectedValue(error);

    await expect(source.prepare(request, signal)).rejects.toBe(error);
  });

  it("retrieves a complete payload without rebuilding exact-width values", async () => {
    const result = getEnginePayloadResult();
    getPayload.mockResolvedValue(result);

    const builtPayload = await source.getPayload(handle, signal);

    expect(getPayload).toHaveBeenCalledWith(ForkName.gloas, payloadId, signal);
    expect(builtPayload.sourceId).toBe(sourceId);
    expect(builtPayload.fork).toBe(ForkName.gloas);
    expect(builtPayload.executionPayload).toBe(result.executionPayload);
    expect(builtPayload.blobsBundle).toBe(result.blobsBundle);
    expect(builtPayload.executionRequests).toBe(result.executionRequests);
    expect(builtPayload.executionPayloadValue).toBe(result.executionPayloadValue);
  });

  it("rejects a handle belonging to another source before calling the Engine API", async () => {
    const error = await getPayloadSourceError(source.getPayload({...handle, sourceId: "engine-1"}, signal));

    expect(error.type).toEqual({
      code: PayloadSourceErrorCode.SOURCE_MISMATCH,
      sourceId,
      handleSourceId: "engine-1",
    });
    expect(getPayload).not.toHaveBeenCalled();
  });

  it("rejects a response without a blobs bundle", async () => {
    getPayload.mockResolvedValue({...getEnginePayloadResult(), blobsBundle: undefined});

    const error = await getPayloadSourceError(source.getPayload(handle, signal));

    expect(error.type).toEqual({code: PayloadSourceErrorCode.MISSING_BLOBS_BUNDLE, sourceId, payloadId});
  });

  it("rejects a response without execution requests", async () => {
    getPayload.mockResolvedValue({...getEnginePayloadResult(), executionRequests: undefined});

    const error = await getPayloadSourceError(source.getPayload(handle, signal));

    expect(error.type).toEqual({code: PayloadSourceErrorCode.MISSING_EXECUTION_REQUESTS, sourceId, payloadId});
  });

  it("propagates retrieval errors without replacing their type", async () => {
    const error = new TimeoutError("engine_getPayloadV6");
    getPayload.mockRejectedValue(error);

    await expect(source.getPayload(handle, signal)).rejects.toBe(error);
  });
});

function getEnginePayloadResult(): EnginePayloadResult {
  return {
    executionPayload: ssz.gloas.ExecutionPayload.defaultValue(),
    blobsBundle: ssz.gloas.BlobsBundle.defaultValue(),
    executionRequests: ssz.gloas.ExecutionRequests.defaultValue(),
    executionPayloadValue: 12_345_678_901_234_567_890n,
  };
}

type NotifyForkchoiceUpdate = (
  fork: ForkPostGloas,
  headBlockHash: RootHex,
  safeBlockHash: RootHex,
  finalizedBlockHash: RootHex,
  payloadAttributes: PayloadAttributes,
  custodyColumns: ColumnIndex[] | null,
  signal: AbortSignal
) => Promise<PayloadId | null>;

type GetPayload = (fork: ForkPostGloas, payloadId: PayloadId, signal: AbortSignal) => Promise<EnginePayloadResult>;

async function getPayloadSourceError(promise: Promise<unknown>): Promise<PayloadSourceError> {
  try {
    await promise;
    throw Error("Expected PayloadSourceError");
  } catch (error) {
    if (!(error instanceof PayloadSourceError)) {
      throw error;
    }
    return error;
  }
}
