import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {ForkName} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {ErrorAborted, TimeoutError, defer} from "@lodestar/utils";
import {
  type PayloadBuildJob,
  PayloadOrchestrator,
  PayloadOrchestratorErrorCode,
} from "../../../src/services/payloadOrchestrator.js";
import {
  type BuildHandle,
  type BuildRequest,
  type BuiltPayload,
  type PayloadSource,
  PayloadSourceError,
  PayloadSourceErrorCode,
} from "../../../src/services/payloadSource.js";

const NOW = 1_000;

class StubPayloadSource implements PayloadSource {
  readonly id = "engine-0";
  readonly prepareCalls: BuildRequest[] = [];
  readonly prepareSignals: AbortSignal[] = [];
  readonly getPayloadCalls: BuildHandle[] = [];
  readonly getPayloadSignals: AbortSignal[] = [];
  prepareImpl: (request: BuildRequest, signal: AbortSignal) => Promise<BuildHandle> = async (request) => ({
    sourceId: this.id,
    fork: request.fork,
    payloadId: "0x01",
  });
  getPayloadImpl: (handle: BuildHandle, signal: AbortSignal) => Promise<BuiltPayload> = async (handle) =>
    builtPayload(handle);

  async prepare<F extends BuildRequest["fork"]>(
    request: BuildRequest<F>,
    signal: AbortSignal
  ): Promise<BuildHandle<F>> {
    this.prepareCalls.push(request);
    this.prepareSignals.push(signal);
    return (await this.prepareImpl(request, signal)) as BuildHandle<F>;
  }

  async getPayload<F extends BuildHandle["fork"]>(
    handle: BuildHandle<F>,
    signal: AbortSignal
  ): Promise<BuiltPayload<F>> {
    this.getPayloadCalls.push(handle);
    this.getPayloadSignals.push(signal);
    return (await this.getPayloadImpl(handle, signal)) as BuiltPayload<F>;
  }
}

function buildRequest(): BuildRequest<ForkName.gloas> {
  return {
    fork: ForkName.gloas,
    forkchoiceState: {
      headBlockHash: `0x${"11".repeat(32)}`,
      safeBlockHash: `0x${"22".repeat(32)}`,
      finalizedBlockHash: `0x${"33".repeat(32)}`,
    },
    payloadAttributes: ssz.gloas.PayloadAttributes.defaultValue(),
    custodyColumns: [0, 3, 127],
  };
}

function buildJob(id = "slot-1-full", getPayloadAt = NOW + 100): PayloadBuildJob {
  return {id, request: buildRequest(), getPayloadAt};
}

function builtPayload(
  handle: BuildHandle = {sourceId: "engine-0", fork: ForkName.gloas, payloadId: "0x01"}
): BuiltPayload {
  return {
    sourceId: handle.sourceId,
    fork: handle.fork,
    executionPayload: ssz.gloas.ExecutionPayload.defaultValue(),
    executionRequests: ssz.gloas.ExecutionRequests.defaultValue(),
    blobsBundle: ssz.gloas.BlobsBundle.defaultValue(),
    executionPayloadValue: 1n,
  };
}

describe("PayloadOrchestrator", () => {
  beforeEach(() => {
    vi.useFakeTimers({now: NOW});
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ["maxActiveJobs", 0, {maxActiveJobs: 0, getPayloadTimeout: 50}],
    ["getPayloadTimeout", 0, {maxActiveJobs: 1, getPayloadTimeout: 0}],
    ["maxActiveJobs", 1.5, {maxActiveJobs: 1.5, getPayloadTimeout: 50}],
  ] as const)("rejects an invalid %s option", (option, value, options) => {
    expect(() => new PayloadOrchestrator(new StubPayloadSource(), options)).toThrowError(
      expect.objectContaining({
        type: {code: PayloadOrchestratorErrorCode.INVALID_OPTION, option, value},
      })
    );
  });

  it("prepares immediately and retrieves at the requested time", async () => {
    const source = new StubPayloadSource();
    const orchestrator = new PayloadOrchestrator(source, {maxActiveJobs: 2, getPayloadTimeout: 50});
    const controller = new AbortController();

    const resultPromise = orchestrator.run(buildJob(), controller.signal);
    await vi.advanceTimersByTimeAsync(99);
    expect(source.prepareCalls).toHaveLength(1);
    expect(source.getPayloadCalls).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1);
    const result = await resultPromise;

    expect(source.getPayloadCalls).toHaveLength(1);
    expect(result.executionPayloadValue).toBe(1n);
    expect(orchestrator.activeJobCount).toBe(0);
  });

  it("shares one promise for duplicate job IDs", async () => {
    const source = new StubPayloadSource();
    const pendingPrepare = defer<BuildHandle>();
    source.prepareImpl = () => pendingPrepare.promise;
    const orchestrator = new PayloadOrchestrator(source, {maxActiveJobs: 2, getPayloadTimeout: 50});
    const controller = new AbortController();
    const job = buildJob();

    const first = orchestrator.run(job, controller.signal);
    const duplicate = orchestrator.run(job, controller.signal);

    expect(duplicate).toBe(first);
    expect(source.prepareCalls).toHaveLength(1);

    pendingPrepare.resolve({sourceId: source.id, fork: ForkName.gloas, payloadId: "0x01"});
    await vi.advanceTimersByTimeAsync(100);
    await expect(first).resolves.toEqual(builtPayload());
    expect(source.getPayloadCalls).toHaveLength(1);
  });

  it("shares the first invocation's cancellation lifecycle for duplicate job IDs", async () => {
    const source = new StubPayloadSource();
    const pendingPrepare = defer<BuildHandle>();
    source.prepareImpl = () => pendingPrepare.promise;
    const orchestrator = new PayloadOrchestrator(source, {maxActiveJobs: 2, getPayloadTimeout: 50});
    const firstController = new AbortController();
    const duplicateController = new AbortController();
    const job = buildJob();

    const first = orchestrator.run(job, firstController.signal);
    const duplicate = orchestrator.run(job, duplicateController.signal);
    duplicateController.abort();

    expect(duplicate).toBe(first);
    expect(orchestrator.activeJobCount).toBe(1);

    pendingPrepare.resolve({sourceId: source.id, fork: ForkName.gloas, payloadId: "0x01"});
    await vi.advanceTimersByTimeAsync(100);
    await expect(first).resolves.toEqual(builtPayload());
    expect(orchestrator.activeJobCount).toBe(0);
  });

  it("rejects a distinct job when the active job limit is reached", async () => {
    const source = new StubPayloadSource();
    source.prepareImpl = () => defer<BuildHandle>().promise;
    const orchestrator = new PayloadOrchestrator(source, {maxActiveJobs: 1, getPayloadTimeout: 50});
    const controller = new AbortController();
    const first = orchestrator.run(buildJob("first"), controller.signal);
    const firstExpectation = expect(first).rejects.toBeInstanceOf(ErrorAborted);

    await expect(orchestrator.run(buildJob("second"), controller.signal)).rejects.toMatchObject({
      type: {code: PayloadOrchestratorErrorCode.ACTIVE_JOB_LIMIT, jobId: "second", maxActiveJobs: 1},
    });

    controller.abort();
    await firstExpectation;
  });

  it("rejects a job whose preparation deadline already passed", async () => {
    const source = new StubPayloadSource();
    const orchestrator = new PayloadOrchestrator(source, {maxActiveJobs: 1, getPayloadTimeout: 50});
    const controller = new AbortController();

    await expect(orchestrator.run(buildJob("stale", NOW), controller.signal)).rejects.toMatchObject({
      type: {code: PayloadOrchestratorErrorCode.PREPARE_DEADLINE_REACHED, jobId: "stale", getPayloadAt: NOW},
    });
    expect(source.prepareCalls).toHaveLength(0);
    expect(orchestrator.activeJobCount).toBe(0);
  });

  it("times out preparation at the retrieval time and suppresses a late result", async () => {
    const source = new StubPayloadSource();
    const pendingPrepare = defer<BuildHandle>();
    source.prepareImpl = () => pendingPrepare.promise;
    const orchestrator = new PayloadOrchestrator(source, {maxActiveJobs: 1, getPayloadTimeout: 50});
    const controller = new AbortController();

    const resultPromise = orchestrator.run(buildJob(), controller.signal);
    const resultExpectation = expect(resultPromise).rejects.toMatchObject({
      type: {code: PayloadOrchestratorErrorCode.PREPARE_TIMEOUT, jobId: "slot-1-full"},
    });
    await vi.advanceTimersByTimeAsync(100);
    await resultExpectation;
    expect(orchestrator.activeJobCount).toBe(0);
    expect(source.prepareSignals[0]?.aborted).toBe(true);

    pendingPrepare.resolve({sourceId: source.id, fork: ForkName.gloas, payloadId: "0x01"});
    await Promise.resolve();
    expect(source.getPayloadCalls).toHaveLength(0);
  });

  it("returns cancellation silently to the caller before preparation", async () => {
    const source = new StubPayloadSource();
    const orchestrator = new PayloadOrchestrator(source, {maxActiveJobs: 1, getPayloadTimeout: 50});
    const controller = new AbortController();
    controller.abort();

    await expect(orchestrator.run(buildJob(), controller.signal)).rejects.toBeInstanceOf(ErrorAborted);
    expect(source.prepareCalls).toHaveLength(0);
  });

  it("stops waiting when aborted during preparation", async () => {
    const source = new StubPayloadSource();
    const pendingPrepare = defer<BuildHandle>();
    source.prepareImpl = () => pendingPrepare.promise;
    const orchestrator = new PayloadOrchestrator(source, {maxActiveJobs: 1, getPayloadTimeout: 50});
    const controller = new AbortController();

    const resultPromise = orchestrator.run(buildJob(), controller.signal);
    controller.abort();

    await expect(resultPromise).rejects.toBeInstanceOf(ErrorAborted);
    expect(orchestrator.activeJobCount).toBe(0);
    expect(source.prepareSignals[0]?.aborted).toBe(true);

    pendingPrepare.resolve({sourceId: source.id, fork: ForkName.gloas, payloadId: "0x01"});
    await Promise.resolve();
    expect(source.getPayloadCalls).toHaveLength(0);
  });

  it("stops waiting when aborted between preparation and retrieval", async () => {
    const source = new StubPayloadSource();
    const orchestrator = new PayloadOrchestrator(source, {maxActiveJobs: 1, getPayloadTimeout: 50});
    const controller = new AbortController();

    const resultPromise = orchestrator.run(buildJob(), controller.signal);
    await Promise.resolve();
    controller.abort();

    await expect(resultPromise).rejects.toBeInstanceOf(ErrorAborted);
    expect(source.prepareCalls).toHaveLength(1);
    expect(source.getPayloadCalls).toHaveLength(0);
    expect(orchestrator.activeJobCount).toBe(0);
  });

  it("stops waiting when aborted during retrieval", async () => {
    const source = new StubPayloadSource();
    const pendingPayload = defer<BuiltPayload>();
    source.getPayloadImpl = () => pendingPayload.promise;
    const orchestrator = new PayloadOrchestrator(source, {maxActiveJobs: 1, getPayloadTimeout: 50});
    const controller = new AbortController();

    const resultPromise = orchestrator.run(buildJob(), controller.signal);
    await vi.advanceTimersByTimeAsync(100);
    expect(source.getPayloadCalls).toHaveLength(1);
    controller.abort();

    await expect(resultPromise).rejects.toBeInstanceOf(ErrorAborted);
    expect(orchestrator.activeJobCount).toBe(0);
    expect(source.getPayloadSignals[0]?.aborted).toBe(true);

    pendingPayload.resolve(builtPayload());
    await Promise.resolve();
    expect(orchestrator.activeJobCount).toBe(0);
  });

  it("propagates a source preparation failure and releases its job", async () => {
    const source = new StubPayloadSource();
    const sourceError = new Error("source unavailable");
    source.prepareImpl = async () => {
      throw sourceError;
    };
    const orchestrator = new PayloadOrchestrator(source, {maxActiveJobs: 1, getPayloadTimeout: 50});
    const controller = new AbortController();

    await expect(orchestrator.run(buildJob(), controller.signal)).rejects.toBe(sourceError);
    expect(orchestrator.activeJobCount).toBe(0);
  });

  it("preserves a source preparation timeout", async () => {
    const source = new StubPayloadSource();
    const sourceError = new TimeoutError("engine_forkchoiceUpdatedV4");
    source.prepareImpl = async () => {
      throw sourceError;
    };
    const orchestrator = new PayloadOrchestrator(source, {maxActiveJobs: 1, getPayloadTimeout: 50});
    const controller = new AbortController();

    await expect(orchestrator.run(buildJob(), controller.signal)).rejects.toBe(sourceError);
    expect(orchestrator.activeJobCount).toBe(0);
  });

  it("propagates missing payload material and permits a later retry", async () => {
    const source = new StubPayloadSource();
    const missingPayload = new PayloadSourceError(
      {code: PayloadSourceErrorCode.MISSING_BLOBS_BUNDLE, sourceId: source.id, payloadId: "0x01"},
      "missing blobs bundle"
    );
    source.getPayloadImpl = async () => {
      throw missingPayload;
    };
    const orchestrator = new PayloadOrchestrator(source, {maxActiveJobs: 1, getPayloadTimeout: 50});
    const controller = new AbortController();
    const job = buildJob();

    const first = orchestrator.run(job, controller.signal);
    const firstExpectation = expect(first).rejects.toBe(missingPayload);
    await vi.advanceTimersByTimeAsync(100);
    await firstExpectation;
    expect(orchestrator.activeJobCount).toBe(0);

    source.getPayloadImpl = async (handle) => builtPayload(handle);
    const retry = orchestrator.run({...job, getPayloadAt: Date.now() + 100}, controller.signal);
    await vi.advanceTimersByTimeAsync(100);
    await expect(retry).resolves.toEqual(builtPayload());
    expect(source.prepareCalls).toHaveLength(2);
  });

  it("times out payload retrieval, ignores a late result, and releases its job", async () => {
    const source = new StubPayloadSource();
    const pendingPayload = defer<BuiltPayload>();
    source.getPayloadImpl = () => pendingPayload.promise;
    const orchestrator = new PayloadOrchestrator(source, {maxActiveJobs: 1, getPayloadTimeout: 50});
    const controller = new AbortController();

    const resultPromise = orchestrator.run(buildJob(), controller.signal);
    const resultExpectation = expect(resultPromise).rejects.toMatchObject({
      type: {code: PayloadOrchestratorErrorCode.GET_PAYLOAD_TIMEOUT, jobId: "slot-1-full"},
    });
    await vi.advanceTimersByTimeAsync(150);
    await resultExpectation;
    expect(orchestrator.activeJobCount).toBe(0);
    expect(source.getPayloadSignals[0]?.aborted).toBe(true);

    pendingPayload.resolve(builtPayload());
    await Promise.resolve();
    expect(orchestrator.activeJobCount).toBe(0);
  });

  it("preserves a source retrieval timeout", async () => {
    const source = new StubPayloadSource();
    const sourceError = new TimeoutError("engine_getPayloadV6");
    source.getPayloadImpl = async () => {
      throw sourceError;
    };
    const orchestrator = new PayloadOrchestrator(source, {maxActiveJobs: 1, getPayloadTimeout: 50});
    const controller = new AbortController();

    const resultPromise = orchestrator.run(buildJob(), controller.signal);
    const resultExpectation = expect(resultPromise).rejects.toBe(sourceError);
    await vi.advanceTimersByTimeAsync(100);
    await resultExpectation;
    expect(orchestrator.activeJobCount).toBe(0);
  });
});
