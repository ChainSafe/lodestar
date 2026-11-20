import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {ForkName} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {ErrorAborted, defer, sleep} from "@lodestar/utils";
import {PayloadSourceNotReady} from "../../../src/services/offerEligibility.js";
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
  type PayloadSourceResources,
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

  it("refuses alternate jobs on an ordinary source before preparing", async () => {
    const source = new StubPayloadSource();
    const job = buildJob();
    job.request.requireUnleased = true;
    const orchestrator = createOrchestrator(source);
    await expect(orchestrator.run(job)).rejects.toMatchObject({
      type: {code: PayloadOrchestratorErrorCode.ALTERNATE_SOURCE_UNSUPPORTED},
    });
    await expect(orchestrator.runSnapshot(job, async () => {})).rejects.toMatchObject({
      type: {code: PayloadOrchestratorErrorCode.ALTERNATE_SOURCE_UNSUPPORTED},
    });
    expect(source.prepareCalls).toHaveLength(0);
  });

  it("requires explicit alternate intent even on a capable source", async () => {
    const source = Object.assign(new StubPayloadSource(), {supportsBoundedAlternates: true});
    await expect(createOrchestrator(source).runSnapshot(buildJob(), async () => {})).rejects.toMatchObject({
      type: {code: PayloadOrchestratorErrorCode.ALTERNATE_SOURCE_UNSUPPORTED},
    });
    expect(source.prepareCalls).toHaveLength(0);
  });

  it.each(["owned", "declined", "throw"] as const)(
    "releases alternate worker independently of retained permission (%s)",
    async (outcome) => {
      const source = Object.assign(new StubPayloadSource(), {
        supportsBoundedAlternates: true,
        supportsRetainedOffers: true,
        renewOffer: vi.fn(async () => true),
        releaseOffer: vi.fn(async () => {}),
        release: vi.fn(async () => {}),
      });
      const payload = builtPayload();
      payload.offerEligibility = {
        generation: "0x0",
        lease: {generation: "0x0", ready: true, validUntil: performance.now() + 250, validUntilUnixMs: NOW + 250},
        retained: {
          id: "offer-fixture",
          namespace: "fixture",
          parentHash: "parent",
          parentBeaconBlockRoot: "root",
          blockHash: "hash",
          slot: "0x1",
          closed: false,
        },
      };
      source.getPayloadImpl = async () => payload;
      const job = buildJob();
      job.request.requireRetainedOffer = true;
      const callback = vi.fn(async () => {
        if (outcome === "throw") throw Error("retention failed");
        return outcome === "owned";
      });
      const promise = createOrchestrator(source).runSnapshot(job, callback);
      const checked =
        outcome === "throw"
          ? expect(promise).rejects.toThrow("retention failed")
          : expect(promise).resolves.toBeUndefined();
      await vi.advanceTimersByTimeAsync(100);
      await checked;
      expect(callback).toHaveBeenCalledWith(payload);
      expect(source.release).toHaveBeenCalledTimes(1);
      expect(source.releaseOffer).toHaveBeenCalledTimes(outcome === "owned" ? 0 : 1);
    }
  );

  it("rejects a retained alternate response without exact permission and cleans the worker", async () => {
    const source = Object.assign(new StubPayloadSource(), {
      supportsBoundedAlternates: true,
      supportsRetainedOffers: true,
      renewOffer: vi.fn(async () => true),
      releaseOffer: vi.fn(async () => {}),
      release: vi.fn(async () => {}),
    });
    const job = buildJob();
    job.request.requireRetainedOffer = true;
    const callback = vi.fn(async () => true);
    const promise = createOrchestrator(source).runSnapshot(job, callback);
    const rejected = expect(promise).rejects.toMatchObject({
      type: {code: PayloadOrchestratorErrorCode.ALTERNATE_SOURCE_UNSUPPORTED},
    });
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    expect(callback).not.toHaveBeenCalled();
    expect(source.release).toHaveBeenCalledTimes(1);
  });

  it("does not deliver a read that finishes after alternate cancellation", async () => {
    const source = Object.assign(new StubPayloadSource(), {
      supportsBoundedAlternates: true,
      release: vi.fn(async () => {}),
    });
    const pending = defer<BuiltPayload>();
    source.getPayloadImpl = () => pending.promise;
    const controller = new AbortController();
    const job = buildJob("alternate");
    job.request.requireUnleased = true;
    const onPayload = vi.fn(async () => {});
    const result = createOrchestrator(source).runSnapshot(job, onPayload, controller.signal);
    const rejected = expect(result).rejects.toBeInstanceOf(ErrorAborted);
    await vi.advanceTimersByTimeAsync(100);
    expect(source.getPayloadCalls).toHaveLength(1);
    controller.abort();
    await rejected;
    pending.resolve(builtPayload());
    await vi.advanceTimersByTimeAsync(1);
    expect(onPayload).not.toHaveBeenCalled();
    expect(source.release).toHaveBeenCalledTimes(1);
  });

  it.each(["aborted", "timeout"])(
    "releases a late retained grant after %s retrieval without blocking worker cleanup",
    async (kind) => {
      const cleanup = defer<void>();
      const source = Object.assign(new StubPayloadSource(), {
        supportsBoundedAlternates: true,
        supportsRetainedOffers: true,
        renewOffer: vi.fn(async () => true),
        releaseOffer: vi.fn(() => cleanup.promise),
        release: vi.fn(async () => {}),
      });
      const pending = defer<BuiltPayload>();
      source.getPayloadImpl = () => pending.promise;
      const controller = new AbortController();
      const job = buildJob("late-grant");
      job.request.requireRetainedOffer = true;
      const callback = vi.fn(async () => true);
      const result = createOrchestrator(source).runSnapshot(job, callback, controller.signal);
      const rejected = expect(result).rejects.toBeInstanceOf(Error);
      await vi.advanceTimersByTimeAsync(100);
      if (kind === "aborted") controller.abort();
      else await vi.advanceTimersByTimeAsync(51);
      await rejected;
      expect(source.release).toHaveBeenCalledTimes(1);
      const payload = builtPayload();
      payload.offerEligibility = {
        generation: "0x0",
        lease: {generation: "0x0", ready: true, validUntil: Infinity, validUntilUnixMs: Infinity},
        retained: {
          id: "late",
          namespace: "fixture",
          parentHash: "parent",
          parentBeaconBlockRoot: "root",
          blockHash: "hash",
          slot: "0x1",
          closed: false,
        },
      };
      pending.resolve(payload);
      await vi.advanceTimersByTimeAsync(1);
      expect(source.releaseOffer).toHaveBeenCalledExactlyOnceWith(payload, expect.any(AbortSignal));
      expect(callback).not.toHaveBeenCalled();
      cleanup.resolve();
      await vi.advanceTimersByTimeAsync(1);
    }
  );

  it("never retries an alternate begin after a transport error", async () => {
    const source = Object.assign(new StubPayloadSource(), {supportsBoundedAlternates: true});
    source.prepareImpl = async () => {
      throw new Error("unknown begin outcome");
    };
    const job = buildJob("alternate", NOW + 500);
    job.request.requireUnleased = true;
    await expect(createOrchestrator(source).runSnapshot(job, async () => {})).rejects.toThrow("unknown begin outcome");
    await vi.advanceTimersByTimeAsync(500);
    expect(source.prepareCalls).toHaveLength(1);
  });

  it("publishes a single alternate before cleanup, while keeping physical resources occupied", async () => {
    const cleanup = defer<void>();
    const resources: PayloadSourceResources = {
      capacity: 2,
      preparing: 0,
      active: 2,
      releasing: 0,
      uncertain: 0,
      alternatesDisabled: false,
    };
    const source = Object.assign(new StubPayloadSource(), {
      supportsBoundedAlternates: true,
      getResources: () => ({...resources}),
      release: vi.fn(async () => {
        resources.active--;
        resources.releasing++;
        await cleanup.promise;
        resources.releasing--;
      }),
    });
    const orchestrator = createOrchestrator(source);
    const job = buildJob("alternate");
    job.request.requireUnleased = true;
    const offered = vi.fn(async () => {});
    const result = orchestrator.runSnapshot(job, offered);
    expect(orchestrator.runSnapshot(job, offered)).toBe(result);
    await vi.advanceTimersByTimeAsync(100);
    expect(offered).toHaveBeenCalledExactlyOnceWith(builtPayload());
    expect(orchestrator.getResources()).toMatchObject({active: 1, releasing: 1});
    expect(source.release).toHaveBeenCalledTimes(1);
    cleanup.resolve();
    await result;
    expect(orchestrator.getResources()).toMatchObject({active: 1, releasing: 0});
  });

  it("keeps failed release uncertainty visible after the alternate callback succeeds", async () => {
    const resources: PayloadSourceResources = {
      capacity: 2,
      preparing: 0,
      active: 2,
      releasing: 0,
      uncertain: 0,
      alternatesDisabled: false,
    };
    const source = Object.assign(new StubPayloadSource(), {
      supportsBoundedAlternates: true,
      getResources: () => ({...resources}),
      release: async () => {
        resources.active--;
        resources.uncertain++;
        throw new Error("end unconfirmed");
      },
      reconcileResources: vi.fn(async (signal: AbortSignal) => {
        signal.throwIfAborted();
        resources.uncertain--;
      }),
    });
    const orchestrator = createOrchestrator(source);
    const job = buildJob("alternate");
    job.request.requireUnleased = true;
    const offered = vi.fn(async () => {});
    const result = orchestrator.runSnapshot(job, offered);
    await vi.advanceTimersByTimeAsync(100);
    await result;
    expect(offered).toHaveBeenCalledTimes(1);
    expect(orchestrator.getResources()).toMatchObject({active: 1, uncertain: 1});
    await orchestrator.reconcileResources();
    expect(source.reconcileResources).toHaveBeenCalledTimes(1);
    expect(orchestrator.getResources()).toMatchObject({active: 1, uncertain: 0});
  });

  it("refuses a leased alternate before invoking its callback and releases it", async () => {
    const source = Object.assign(new StubPayloadSource(), {
      supportsBoundedAlternates: true,
      release: vi.fn(async () => {}),
    });
    source.getPayloadImpl = async () => ({
      ...builtPayload(),
      offerEligibility: {
        generation: "0x0",
        lease: {generation: "0x0", ready: true, validUntil: Infinity, validUntilUnixMs: Infinity},
      },
    });
    const job = buildJob("alternate");
    job.request.requireUnleased = true;
    const offered = vi.fn(async () => {});
    const result = createOrchestrator(source).runSnapshot(job, offered);
    const rejected = expect(result).rejects.toMatchObject({
      type: {code: PayloadOrchestratorErrorCode.LEASED_PAYLOAD_REQUIRES_UPDATES},
    });
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    expect(offered).not.toHaveBeenCalled();
    expect(source.release).toHaveBeenCalledTimes(1);
  });

  it("releases an alternate after a failed durable callback", async () => {
    const source = Object.assign(new StubPayloadSource(), {
      supportsBoundedAlternates: true,
      release: vi.fn(async () => {}),
    });
    const job = buildJob("alternate");
    job.request.requireUnleased = true;
    const result = createOrchestrator(source).runSnapshot(job, async () => {
      throw new Error("durability failed");
    });
    const rejected = expect(result).rejects.toThrow("durability failed");
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    expect(source.release).toHaveBeenCalledTimes(1);
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

  it("rejects one-shot mode for a source requiring renewable offer leases", async () => {
    const source = new StubPayloadSource();
    source.getPayloadImpl = async () => ({
      ...builtPayload(),
      offerEligibility: {
        generation: "0x0",
        lease: {generation: "0x0", ready: true, validUntil: Infinity, validUntilUnixMs: Infinity},
      },
    });
    const result = createOrchestrator(source).run(buildJob());
    const rejected = expect(result).rejects.toMatchObject({
      type: {code: PayloadOrchestratorErrorCode.LEASED_PAYLOAD_REQUIRES_UPDATES},
    });
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
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

  it.each([
    {retrieveMs: 4, publishMs: 16, expected: [0, 25, 50, 75]},
    {retrieveMs: 4, publishMs: 30, expected: [0, 35, 70]},
  ])(
    "counts retrieval and publication towards the update interval: $publishMs ms",
    async ({retrieveMs, publishMs, expected}) => {
      const source = new StubPayloadSource();
      const calls: number[] = [];
      let publishing = false;
      source.getPayloadImpl = async (handle) => {
        expect(publishing).toBe(false);
        calls.push(Date.now() - NOW);
        await sleep(retrieveMs);
        return builtPayload(handle);
      };
      const release = vi.fn(async () => {});
      const orchestrator = createOrchestrator(Object.assign(source, {release}));
      const onPayload = vi.fn(async () => {
        publishing = true;
        await sleep(publishMs);
        publishing = false;
      });
      const result = orchestrator.runUpdates(buildJob(), {intervalMs: 25, until: NOW + 100}, onPayload);
      await vi.advanceTimersByTimeAsync(150);
      await result;
      expect(calls).toEqual(expected);
      expect(onPayload).toHaveBeenCalledTimes(expected.length);
      expect(release).toHaveBeenCalledTimes(1);
    }
  );

  it("waits through an invalidated generation without re-exposing the previous payload", async () => {
    const source = new StubPayloadSource();
    const first = builtPayload();
    const second = {...first, executionPayloadValue: 0n};
    let calls = 0;
    source.getPayloadImpl = async () => {
      calls++;
      if (calls === 1) return first;
      if (calls < 4) throw new PayloadSourceNotReady();
      return second;
    };
    const onPayload = vi.fn(async () => {});
    const result = createOrchestrator(source).runUpdates(buildJob(), {intervalMs: 25, until: NOW + 150}, onPayload);
    await vi.advanceTimersByTimeAsync(160);
    await result;
    expect(onPayload.mock.calls).toEqual([[first], [second]]);
  });

  it("keeps unchanged payload polling bounded and releases on cancellation", async () => {
    const source = new StubPayloadSource();
    const payload = builtPayload();
    source.getPayloadImpl = async () => payload;
    const release = vi.fn(async () => {});
    const controller = new AbortController();
    const orchestrator = createOrchestrator(Object.assign(source, {release}), controller);
    const onPayload = vi.fn(async () => {});
    const result = orchestrator.runUpdates(buildJob(), {intervalMs: 25, until: NOW + 100}, onPayload);
    const rejected = expect(result).rejects.toBeInstanceOf(ErrorAborted);
    await vi.advanceTimersByTimeAsync(74);
    expect(source.getPayloadCalls).toHaveLength(3);
    expect(onPayload).toHaveBeenCalledTimes(1);
    controller.abort();
    await rejected;
    expect(release).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(source.getPayloadCalls).toHaveLength(3);
  });

  it.each([40, 120])("preserves cancellation during a %d ms publication", async (publishMs) => {
    const source = new StubPayloadSource();
    const release = vi.fn(async () => {});
    const controller = new AbortController();
    const orchestrator = createOrchestrator(Object.assign(source, {release}), controller);
    const onPayload = vi.fn(async () => sleep(publishMs));
    const result = orchestrator.runUpdates(buildJob(), {intervalMs: 25, until: NOW + 100}, onPayload);
    const rejected = expect(result).rejects.toBeInstanceOf(ErrorAborted);
    await vi.advanceTimersByTimeAsync(10);
    controller.abort();
    await vi.advanceTimersByTimeAsync(publishMs);
    await rejected;
    expect(source.getPayloadCalls).toHaveLength(1);
    expect(onPayload).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("does not extend the polling interval when the wall clock moves backward", async () => {
    const source = new StubPayloadSource();
    const calls: number[] = [];
    source.getPayloadImpl = async (handle) => {
      calls.push(Date.now());
      return builtPayload(handle);
    };
    const orchestrator = createOrchestrator(source);
    const onPayload = vi.fn(async () => {
      if (calls.length === 1) vi.setSystemTime(NOW - 1000);
    });
    const result = orchestrator.runUpdates(buildJob(), {intervalMs: 25, until: NOW + 100}, onPayload);
    await vi.advanceTimersByTimeAsync(26);
    expect(calls).toEqual([NOW, NOW - 1000 + 25]);
    await vi.advanceTimersByTimeAsync(1100);
    await result;
  });

  it.each([
    {name: "normal cutoff after a ready payload", untilMs: 60, firstReady: true, succeeds: true},
    {name: "retrieval timeout before the cutoff", untilMs: 100, firstReady: true, succeeds: false},
    {name: "cutoff without any ready payload", untilMs: 30, firstReady: false, succeeds: false},
  ])("handles $name and releases the constructor", async ({untilMs, firstReady, succeeds}) => {
    const source = new StubPayloadSource();
    const release = vi.fn(async () => {});
    const pending = defer<BuiltPayload>();
    source.getPayloadImpl = async (handle) =>
      firstReady && source.getPayloadCalls.length === 1 ? builtPayload(handle) : pending.promise;
    const orchestrator = createOrchestrator(Object.assign(source, {release}));
    const onPayload = vi.fn(async () => {});
    const result = orchestrator.runUpdates(buildJob(), {intervalMs: 25, until: NOW + untilMs}, onPayload);
    const outcome = result.then(
      () => ({error: undefined}),
      (error: unknown) => ({error})
    );
    await vi.advanceTimersByTimeAsync(untilMs);
    if (succeeds) expect((await outcome).error).toBeUndefined();
    else expect((await outcome).error).toMatchObject({type: {code: PayloadOrchestratorErrorCode.GET_PAYLOAD_TIMEOUT}});
    expect(onPayload).toHaveBeenCalledTimes(firstReady ? 1 : 0);
    expect(release).toHaveBeenCalledTimes(1);
    expect(source.getPayloadSignals.at(-1)?.aborted).toBe(true);
    pending.resolve(builtPayload());
    await vi.advanceTimersByTimeAsync(100);
    expect(onPayload).toHaveBeenCalledTimes(firstReady ? 1 : 0);
  });
});
