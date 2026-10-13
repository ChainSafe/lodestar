import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {ForkName} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {ErrorAborted, defer} from "@lodestar/utils";
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

  async prepare(request: BuildRequest, signal: AbortSignal): Promise<BuildHandle> {
    this.prepareCalls.push(request);
    this.prepareSignals.push(signal);
    return this.prepareImpl(request, signal);
  }

  async getPayload(handle: BuildHandle, signal: AbortSignal): Promise<BuiltPayload> {
    this.getPayloadCalls.push(handle);
    this.getPayloadSignals.push(signal);
    return this.getPayloadImpl(handle, signal);
  }
}

function buildRequest(): BuildRequest {
  return {
    fork: ForkName.gloas,
    forkchoiceState: {
      headBlockHash: `0x${"11".repeat(32)}`,
      safeBlockHash: `0x${"22".repeat(32)}`,
      finalizedBlockHash: `0x${"33".repeat(32)}`,
    },
    payloadAttributes: ssz.gloas.PayloadAttributes.defaultValue(),
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

function createOrchestrator(source: PayloadSource, controller = new AbortController()): PayloadOrchestrator {
  return new PayloadOrchestrator(source, {getPayloadTimeout: 50}, controller.signal);
}

describe("PayloadOrchestrator", () => {
  beforeEach(() => {
    vi.useFakeTimers({now: NOW});
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("prepares immediately and retrieves at the requested time", async () => {
    const source = new StubPayloadSource();
    const orchestrator = createOrchestrator(source);

    const resultPromise = orchestrator.run(buildJob());
    await vi.advanceTimersByTimeAsync(99);
    expect(source.prepareCalls).toHaveLength(1);
    expect(source.getPayloadCalls).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1);
    await expect(resultPromise).resolves.toEqual(builtPayload());
    expect(source.getPayloadCalls).toHaveLength(1);
  });

  it("shares one build for duplicate job IDs", async () => {
    const source = new StubPayloadSource();
    const orchestrator = createOrchestrator(source);

    const first = orchestrator.run(buildJob());
    const duplicate = orchestrator.run(buildJob("slot-1-full", NOW + 200));
    expect(duplicate).toBe(first);

    await vi.advanceTimersByTimeAsync(100);
    await expect(duplicate).resolves.toEqual(builtPayload());
    expect(source.prepareCalls).toHaveLength(1);
    expect(source.getPayloadCalls).toHaveLength(1);
  });

  it("builds different branches independently", async () => {
    const source = new StubPayloadSource();
    const fullRequest = buildRequest();
    source.prepareImpl = async (request) => {
      if (request === fullRequest) throw new Error("unknown parent");
      return {sourceId: source.id, fork: request.fork, payloadId: "0x02"};
    };
    const orchestrator = createOrchestrator(source);

    const full = orchestrator.run({id: "slot-1-full", request: fullRequest, getPayloadAt: NOW + 100});
    const empty = orchestrator.run(buildJob("slot-1-empty"));
    const fullExpectation = expect(full).rejects.toMatchObject({
      type: {code: PayloadOrchestratorErrorCode.PREPARE_TIMEOUT, jobId: "slot-1-full"},
    });
    await vi.advanceTimersByTimeAsync(100);

    await fullExpectation;
    await expect(empty).resolves.toEqual(builtPayload({sourceId: source.id, fork: ForkName.gloas, payloadId: "0x02"}));
    expect(source.getPayloadCalls).toHaveLength(1);
  });

  it("stops all branches when the builder is stopped", async () => {
    const source = new StubPayloadSource();
    const controller = new AbortController();
    const orchestrator = createOrchestrator(source, controller);

    const full = orchestrator.run(buildJob("slot-1-full"));
    const empty = orchestrator.run(buildJob("slot-1-empty"));
    controller.abort();

    await expect(full).rejects.toBeInstanceOf(ErrorAborted);
    await expect(empty).rejects.toBeInstanceOf(ErrorAborted);
    await vi.advanceTimersByTimeAsync(100);
    expect(source.getPayloadCalls).toHaveLength(0);
  });

  it("starts a new build for a job ID once the previous build settled", async () => {
    const source = new StubPayloadSource();
    const orchestrator = createOrchestrator(source);

    const first = orchestrator.run(buildJob());
    await vi.advanceTimersByTimeAsync(100);
    await first;

    const second = orchestrator.run(buildJob("slot-1-full", Date.now() + 100));
    expect(second).not.toBe(first);
    await vi.advanceTimersByTimeAsync(100);
    await expect(second).resolves.toEqual(builtPayload());
    expect(source.prepareCalls).toHaveLength(2);
  });

  it.each([NOW, NOW - 1, Number.NaN])("rejects a job whose preparation deadline is %s", async (getPayloadAt) => {
    const source = new StubPayloadSource();
    const orchestrator = createOrchestrator(source);

    await expect(orchestrator.run(buildJob("late", getPayloadAt))).rejects.toMatchObject({
      type: {code: PayloadOrchestratorErrorCode.PREPARE_DEADLINE_REACHED, jobId: "late", getPayloadAt},
    });
    expect(source.prepareCalls).toHaveLength(0);
  });

  it("times out preparation at the retrieval time and suppresses a late result", async () => {
    const source = new StubPayloadSource();
    const pendingPrepare = defer<BuildHandle>();
    source.prepareImpl = () => pendingPrepare.promise;
    const orchestrator = createOrchestrator(source);

    const resultPromise = orchestrator.run(buildJob());
    const resultExpectation = expect(resultPromise).rejects.toMatchObject({
      type: {code: PayloadOrchestratorErrorCode.PREPARE_TIMEOUT, jobId: "slot-1-full"},
    });
    await vi.advanceTimersByTimeAsync(100);
    await resultExpectation;
    expect(source.prepareSignals[0]?.aborted).toBe(true);

    pendingPrepare.resolve({sourceId: source.id, fork: ForkName.gloas, payloadId: "0x01"});
    await vi.advanceTimersByTimeAsync(100);
    expect(source.getPayloadCalls).toHaveLength(0);
  });

  it("rejects a job once the builder is stopped", async () => {
    const source = new StubPayloadSource();
    const controller = new AbortController();
    const orchestrator = createOrchestrator(source, controller);
    controller.abort();

    await expect(orchestrator.run(buildJob())).rejects.toBeInstanceOf(ErrorAborted);
    expect(source.prepareCalls).toHaveLength(0);
  });

  it("stops when aborted during preparation", async () => {
    const source = new StubPayloadSource();
    const pendingPrepare = defer<BuildHandle>();
    source.prepareImpl = () => pendingPrepare.promise;
    const controller = new AbortController();
    const orchestrator = createOrchestrator(source, controller);

    const resultPromise = orchestrator.run(buildJob());
    controller.abort();

    await expect(resultPromise).rejects.toBeInstanceOf(ErrorAborted);
    expect(source.prepareSignals[0]?.aborted).toBe(true);

    pendingPrepare.resolve({sourceId: source.id, fork: ForkName.gloas, payloadId: "0x01"});
    await vi.advanceTimersByTimeAsync(100);
    expect(source.getPayloadCalls).toHaveLength(0);
  });

  it("stops when aborted while waiting for the retrieval time", async () => {
    const source = new StubPayloadSource();
    const controller = new AbortController();
    const orchestrator = createOrchestrator(source, controller);

    const resultPromise = orchestrator.run(buildJob());
    const resultExpectation = expect(resultPromise).rejects.toBeInstanceOf(ErrorAborted);
    await vi.advanceTimersByTimeAsync(0);
    expect(source.prepareCalls).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(1);
    controller.abort();

    await resultExpectation;
    await vi.advanceTimersByTimeAsync(100);
    expect(source.getPayloadCalls).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops when aborted during retrieval", async () => {
    const source = new StubPayloadSource();
    const pendingPayload = defer<BuiltPayload>();
    source.getPayloadImpl = () => pendingPayload.promise;
    const controller = new AbortController();
    const orchestrator = createOrchestrator(source, controller);

    const resultPromise = orchestrator.run(buildJob());
    await vi.advanceTimersByTimeAsync(100);
    expect(source.getPayloadCalls).toHaveLength(1);
    controller.abort();

    await expect(resultPromise).rejects.toBeInstanceOf(ErrorAborted);
    expect(source.getPayloadSignals[0]?.aborted).toBe(true);
  });

  it("retries a failing preparation until it succeeds", async () => {
    const source = new StubPayloadSource();
    source.prepareImpl = async (request) => {
      if (source.prepareCalls.length < 3) {
        throw new PayloadSourceError({code: PayloadSourceErrorCode.NO_PAYLOAD_ID, sourceId: source.id});
      }
      return {sourceId: source.id, fork: request.fork, payloadId: "0x01"};
    };
    const orchestrator = createOrchestrator(source);
    const result = orchestrator.run(buildJob("retry", NOW + 350));

    await vi.advanceTimersByTimeAsync(199);
    expect(source.prepareCalls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(source.prepareCalls).toHaveLength(3);
    expect(source.getPayloadCalls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(150);
    await expect(result).resolves.toEqual(builtPayload());
    expect(source.getPayloadCalls).toHaveLength(1);
  });

  it("does not extend the preparation deadline while retrying and reports the last error", async () => {
    const source = new StubPayloadSource();
    source.prepareImpl = async () => {
      throw new Error("Execution Layer Syncing");
    };
    const orchestrator = createOrchestrator(source);
    const result = orchestrator.run(buildJob("deadline", NOW + 250));
    const assertion = expect(result).rejects.toMatchObject({
      type: {
        code: PayloadOrchestratorErrorCode.PREPARE_TIMEOUT,
        jobId: "deadline",
        lastError: "Execution Layer Syncing",
      },
    });

    await vi.advanceTimersByTimeAsync(250);
    await assertion;
    expect(source.prepareCalls).toHaveLength(3);
    expect(source.getPayloadCalls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(source.prepareCalls).toHaveLength(3);
  });

  it("cancels preparation backoff without sending another request", async () => {
    const source = new StubPayloadSource();
    source.prepareImpl = async () => {
      throw new PayloadSourceError({code: PayloadSourceErrorCode.NO_PAYLOAD_ID, sourceId: source.id});
    };
    const controller = new AbortController();
    const orchestrator = createOrchestrator(source, controller);
    const result = orchestrator.run(buildJob("cancel", NOW + 350));
    const assertion = expect(result).rejects.toBeInstanceOf(ErrorAborted);
    await vi.advanceTimersByTimeAsync(50);
    controller.abort();
    await assertion;
    await vi.advanceTimersByTimeAsync(500);
    expect(source.prepareCalls).toHaveLength(1);
    expect(source.getPayloadCalls).toHaveLength(0);
  });

  it("propagates a missing blobs bundle and permits a new build", async () => {
    const source = new StubPayloadSource();
    const missingBlobsBundle = new PayloadSourceError(
      {code: PayloadSourceErrorCode.MISSING_BLOBS_BUNDLE, sourceId: source.id, payloadId: "0x01"},
      "missing blobs bundle"
    );
    source.getPayloadImpl = async () => {
      throw missingBlobsBundle;
    };
    const orchestrator = createOrchestrator(source);
    const job = buildJob();

    const first = orchestrator.run(job);
    const firstExpectation = expect(first).rejects.toBe(missingBlobsBundle);
    await vi.advanceTimersByTimeAsync(100);
    await firstExpectation;

    source.getPayloadImpl = async (handle) => builtPayload(handle);
    const retry = orchestrator.run({...job, getPayloadAt: Date.now() + 100});
    await vi.advanceTimersByTimeAsync(100);
    await expect(retry).resolves.toEqual(builtPayload());
    expect(source.prepareCalls).toHaveLength(2);
  });

  it("times out payload retrieval and ignores a late result", async () => {
    const source = new StubPayloadSource();
    const pendingPayload = defer<BuiltPayload>();
    source.getPayloadImpl = () => pendingPayload.promise;
    const orchestrator = createOrchestrator(source);

    const resultPromise = orchestrator.run(buildJob());
    const resultExpectation = expect(resultPromise).rejects.toMatchObject({
      type: {code: PayloadOrchestratorErrorCode.GET_PAYLOAD_TIMEOUT, jobId: "slot-1-full"},
    });
    await vi.advanceTimersByTimeAsync(150);
    await resultExpectation;
    expect(source.getPayloadSignals[0]?.aborted).toBe(true);

    pendingPayload.resolve(builtPayload());
    const next = orchestrator.run(buildJob("slot-1-full", Date.now() + 100));
    expect(next).not.toBe(resultPromise);
    await vi.advanceTimersByTimeAsync(100);
    expect(source.prepareCalls).toHaveLength(2);
  });
});
