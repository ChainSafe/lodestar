import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {JsonRpcHttpClient} from "@lodestar/beacon-node";
import {type BuildHandle, type BuildRequest, type BuiltPayload, PayloadSourceNotReady} from "@lodestar/builder";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {SecretKey} from "@lodestar/native/blst";
import {ForkName} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {defer, sleep, toRootHex} from "@lodestar/utils";
import {BuilderSigner} from "../../../../../builder/src/services/builderSigner.js";
import {PayloadOrchestrator} from "../../../../../builder/src/services/payloadOrchestrator.js";
import {PayloadStore} from "../../../../../builder/src/services/payloadStore.js";
import {ProposerPreferencesTracker} from "../../../../../builder/src/services/proposerPreferencesTracker.js";
import {getApiClientStub, mockApiResponse} from "../../../../../builder/test/unit/utils/apiStub.js";
import {createBiddingModules} from "../../../../../builder/test/unit/utils/bidding.js";
import {ClockMock} from "../../../../../builder/test/unit/utils/clock.js";
import {getMockedLogger} from "../../../../../builder/test/unit/utils/logger.js";
import {mockBuiltPayload} from "../../../../../builder/test/unit/utils/payload.js";
import {
  ForkTransitionPayloadErrorCode,
  ForkTransitionPayloadSource,
} from "../../../../src/cmds/builder/forkTransitionPayloadSource.js";
import {SessionPayloadSource} from "../../../../src/cmds/builder/sessionPayloadSource.js";

// Match the error class from the source orchestrator rather than mixing it with the compiled package export.
vi.mock("@lodestar/builder", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@lodestar/builder")>()),
  PayloadSourceNotReady: (await import("../../../../../builder/src/services/offerEligibility.js"))
    .PayloadSourceNotReady,
}));

const forkSlot = 32;
const signal = new AbortController().signal;

function request(slotNumber = forkSlot): BuildRequest {
  return {
    fork: ForkName.gloas,
    forkchoiceState: {
      headBlockHash: `0x${"11".repeat(32)}`,
      safeBlockHash: `0x${"22".repeat(32)}`,
      finalizedBlockHash: `0x${"33".repeat(32)}`,
    },
    payloadAttributes: {...ssz.gloas.PayloadAttributes.defaultValue(), slotNumber, timestamp: slotNumber * 12},
  };
}

function stub(id: string) {
  return {
    id,
    supportsUpdates: true,
    supportsBoundedAlternates: true,
    supportsRetainedOffers: true,
    supportsPrimaryHandoff: true,
    prepare: vi.fn(
      async (req: BuildRequest, _signal: AbortSignal): Promise<BuildHandle> => ({
        sourceId: id,
        fork: req.fork,
        payloadId: "0x01",
      })
    ),
    getPayload: vi.fn(
      async (handle: BuildHandle, _signal: AbortSignal): Promise<BuiltPayload> => ({
        sourceId: id,
        fork: handle.fork,
        executionPayload: ssz.gloas.ExecutionPayload.defaultValue(),
        executionRequests: ssz.gloas.ExecutionRequests.defaultValue(),
        blobsBundle: ssz.gloas.BlobsBundle.defaultValue(),
        executionPayloadValue: 1n,
      })
    ),
    release: vi.fn(async (_handle: BuildHandle, _signal: AbortSignal): Promise<void> => {}),
    retainPrimaryPayload: vi.fn(
      async (_handle: BuildHandle, payload: BuiltPayload, _signal: AbortSignal): Promise<BuiltPayload> => ({
        ...payload,
        executionPayloadValue: payload.executionPayloadValue + 1n,
      })
    ),
    renewOffer: vi.fn(async (_payload: BuiltPayload, _signal: AbortSignal): Promise<boolean> => true),
    releaseOffer: vi.fn(async (_payload: BuiltPayload, _signal: AbortSignal): Promise<void> => {}),
    reconcileResources: vi.fn(async (_signal: AbortSignal): Promise<void> => {}),
    getResources: vi.fn(() => ({
      capacity: 2 as const,
      preparing: 0,
      active: 1,
      releasing: 0,
      uncertain: 1,
      alternatesDisabled: false,
    })),
  };
}

describe("ForkTransitionPayloadSource", () => {
  beforeEach(() => vi.useFakeTimers({now: (forkSlot - 1) * 12_000}));
  afterEach(() => vi.useRealTimers());

  it.each([forkSlot - 1, forkSlot, forkSlot + 1])(
    "selects the original constructor at proposal slot %i",
    async (slot) => {
      const sessions = stub("sessions");
      const engine = stub("engine");
      const source = new ForkTransitionPayloadSource(sessions, engine, forkSlot, 900);
      const selected = slot <= forkSlot ? engine : sessions;
      const unused = selected === engine ? sessions : engine;
      const handle = await source.prepare(request(slot), signal);
      expect(selected.prepare).toHaveBeenCalledExactlyOnceWith(request(slot), signal);
      expect(unused.prepare).not.toHaveBeenCalled();
      await source.release(handle, signal);
      expect(selected.release).toHaveBeenCalledExactlyOnceWith(handle, signal);
      expect(unused.release).not.toHaveBeenCalled();
    }
  );

  it("builds only on the Engine through the cutoff, snapshots at the deadline, and keeps the retained payload", async () => {
    const sessions = stub("sessions");
    const engine = stub("engine");
    const source = new ForkTransitionPayloadSource(sessions, engine, forkSlot, 900);
    const handle = await source.prepare(request(), signal);
    expect(engine.prepare).toHaveBeenCalledExactlyOnceWith(request(), signal);
    expect(sessions.prepare).not.toHaveBeenCalled();
    await expect(source.getPayload(handle, signal)).rejects.toBeInstanceOf(PayloadSourceNotReady);
    expect(engine.getPayload).not.toHaveBeenCalled();

    vi.setSystemTime(forkSlot * 12_000 - 900);
    const snapshot = await source.getPayload(handle, signal);
    vi.setSystemTime((forkSlot + 1) * 12_000);
    const nextHandle = await source.prepare(request(forkSlot + 1), signal);
    expect(sessions.prepare).toHaveBeenCalledOnce();
    expect(await source.getPayload(handle, signal)).toBe(snapshot);
    expect(engine.getPayload).toHaveBeenCalledOnce();
    await source.release(handle, signal);
    expect(engine.release).toHaveBeenCalledExactlyOnceWith(handle, signal);
    expect(snapshot.executionPayloadValue).toBe(1n);
    await expect(source.getPayload(handle, signal)).rejects.toMatchObject({
      type: {code: ForkTransitionPayloadErrorCode.UNKNOWN_HANDLE},
    });
    await source.getPayload(nextHandle, signal);
    await source.getPayload(nextHandle, signal);
    expect(sessions.getPayload).toHaveBeenCalledTimes(2);
    await source.release(nextHandle, signal);
    expect(sessions.release).toHaveBeenCalledExactlyOnceWith(nextHandle, signal);
  });

  it("does not fall back to the Engine after any post-cutoff constructor error", async () => {
    const sessions = stub("sessions");
    const engine = stub("engine");
    const error = new Error("ambiguous native begin");
    sessions.prepare.mockRejectedValue(error);
    const source = new ForkTransitionPayloadSource(sessions, engine, forkSlot, 900);
    await expect(source.prepare(request(forkSlot + 1), signal)).rejects.toBe(error);
    expect(engine.prepare).not.toHaveBeenCalled();
    expect(engine.getPayload).not.toHaveBeenCalled();
  });

  it.each(["requireUnleased", "requireRetainedOffer"] as const)(
    "rejects alternate Engine work (%s) before allocation and delegates native resource ownership",
    async (mode) => {
      const sessions = stub("sessions");
      const engine = stub("engine");
      const source = new ForkTransitionPayloadSource(sessions, engine, forkSlot, 900);
      await expect(source.prepare({...request(), [mode]: true}, signal)).rejects.toMatchObject({
        type: {code: ForkTransitionPayloadErrorCode.ALTERNATE_UNSUPPORTED},
      });
      expect(engine.prepare).not.toHaveBeenCalled();
      expect(source.getResources()).toEqual(sessions.getResources());
      expect(source.supportsUpdates).toBe(true);
      expect(source.supportsBoundedAlternates).toBe(true);
      await source.reconcileResources(signal);
      expect(sessions.reconcileResources).toHaveBeenCalledExactlyOnceWith(signal);
      await source.prepare({...request(forkSlot + 1), [mode]: true}, signal);
      expect(sessions.prepare).toHaveBeenCalledOnce();
    }
  );

  it("advertises retained capabilities only when the native source supports them", () => {
    const sessions = stub("sessions");
    const engine = stub("engine");
    const source = new ForkTransitionPayloadSource(sessions, engine, forkSlot, 900);
    expect(source.supportsRetainedOffers).toBe(true);
    expect(source.supportsPrimaryHandoff).toBe(true);
    sessions.supportsRetainedOffers = false;
    expect(source.supportsRetainedOffers).toBe(false);
    expect(source.supportsPrimaryHandoff).toBe(false);
    sessions.supportsRetainedOffers = true;
    sessions.supportsPrimaryHandoff = false;
    expect(source.supportsRetainedOffers).toBe(true);
    expect(source.supportsPrimaryHandoff).toBe(false);
  });

  it("learns real native retained capabilities on the first post-cutoff primary begin", async () => {
    const rpc = new JsonRpcHttpClient(["http://127.0.0.1:1"]);
    const fetch = vi.spyOn(rpc, "fetch");
    const sessions = new SessionPayloadSource("sessions", () => rpc, {
      boundedAlternates: true,
      retainedAlternateOffers: true,
      primaryHandoff: true,
    });
    const engine = stub("engine");
    const source = new ForkTransitionPayloadSource(sessions, engine, forkSlot, 900);
    expect(source.supportsRetainedOffers).toBe(false);
    expect(source.supportsPrimaryHandoff).toBe(false);
    const engineHandle = await source.prepare(request(), signal);
    vi.setSystemTime(forkSlot * 12_000 - 900);
    await source.getPayload(engineHandle, signal);
    await source.release(engineHandle, signal);
    expect(fetch).not.toHaveBeenCalled();
    expect(source.supportsRetainedOffers).toBe(false);
    expect(source.supportsPrimaryHandoff).toBe(false);

    const instance = "ab".repeat(16);
    const capabilities = {orderGenerationVersion: 1, retainedOfferVersion: 1, primaryHandoffVersion: 1};
    fetch.mockResolvedValueOnce({sessionId: `native-${instance}-0-1`, ...capabilities});
    const primary = await source.prepare(request(forkSlot + 1), signal);
    expect(source.supportsRetainedOffers).toBe(true);
    expect(source.supportsPrimaryHandoff).toBe(true);
    expect(fetch.mock.calls[0][0].method).toBe("zbuilder_beginV1");
    fetch.mockResolvedValueOnce({
      sessionId: `native-${instance}-1-2`,
      ...capabilities,
      alternateSessionVersion: 2,
    });
    const alternate = await source.prepare({...request(forkSlot + 1), requireRetainedOffer: true}, signal);
    expect(fetch.mock.calls[1][0].method).toBe("zbuilder_beginAlternateV2");
    expect(engine.prepare).toHaveBeenCalledOnce();
    expect(source.getResources()).toMatchObject({active: 2, uncertain: 0, alternatesDisabled: false});
    fetch.mockResolvedValue(true);
    await source.release(alternate, signal);
    await source.release(primary, signal);
    expect(source.getResources()).toMatchObject({active: 0, uncertain: 0});
  });

  it("keeps native retained offers owned after their worker releases, without routing through the Engine", async () => {
    const sessions = stub("same-id");
    const engine = stub("same-id");
    const source = new ForkTransitionPayloadSource(sessions, engine, forkSlot, 900);
    const handle = await source.prepare(request(forkSlot + 1), signal);
    const payload = await source.getPayload(handle, signal);
    const retained = await source.retainPrimaryPayload(handle, payload, signal);
    expect(sessions.retainPrimaryPayload).toHaveBeenCalledExactlyOnceWith(handle, payload, signal);
    await source.release(handle, signal);
    expect(await source.renewOffer(retained, signal)).toBe(true);
    expect(sessions.renewOffer).toHaveBeenCalledExactlyOnceWith(retained, signal);
    sessions.releaseOffer.mockRejectedValueOnce(new Error("release reply lost"));
    await expect(source.releaseOffer(retained, signal)).rejects.toThrow("release reply lost");
    await source.releaseOffer(retained, signal);
    expect(sessions.releaseOffer).toHaveBeenCalledTimes(2);
    await expect(source.renewOffer(retained, signal)).rejects.toMatchObject({
      type: {code: ForkTransitionPayloadErrorCode.UNKNOWN_PAYLOAD},
    });
    await expect(source.releaseOffer(retained, signal)).rejects.toMatchObject({
      type: {code: ForkTransitionPayloadErrorCode.UNKNOWN_PAYLOAD},
    });
    expect(sessions.renewOffer).toHaveBeenCalledOnce();
    expect(sessions.releaseOffer).toHaveBeenCalledTimes(2);
    expect(engine.retainPrimaryPayload).not.toHaveBeenCalled();
    expect(engine.renewOffer).not.toHaveBeenCalled();
    expect(engine.releaseOffer).not.toHaveBeenCalled();
  });

  it("rejects foreign or cross-handle snapshots even with the same native payload id", async () => {
    const sessions = stub("same-id");
    const source = new ForkTransitionPayloadSource(sessions, stub("same-id"), forkSlot, 900);
    const handle = await source.prepare(request(forkSlot + 1), signal);
    const otherHandle = await source.prepare(request(forkSlot + 1), signal);
    const payload = await source.getPayload(handle, signal);
    const otherPayload = await source.getPayload(otherHandle, signal);
    for (const unknown of [{...payload}, otherPayload]) {
      await expect(source.retainPrimaryPayload(handle, unknown, signal)).rejects.toMatchObject({
        type: {code: "FORK_TRANSITION_PAYLOAD_UNKNOWN_PAYLOAD"},
      });
    }
    await expect(source.renewOffer({...payload}, signal)).rejects.toMatchObject({
      type: {code: "FORK_TRANSITION_PAYLOAD_UNKNOWN_PAYLOAD"},
    });
    await expect(source.releaseOffer({...payload}, signal)).rejects.toMatchObject({
      type: {code: "FORK_TRANSITION_PAYLOAD_UNKNOWN_PAYLOAD"},
    });
    expect(sessions.retainPrimaryPayload).not.toHaveBeenCalled();
    expect(sessions.renewOffer).not.toHaveBeenCalled();
    expect(sessions.releaseOffer).not.toHaveBeenCalled();
  });

  it("never retains or renews an Engine snapshot even after the cutoff", async () => {
    const sessions = stub("same-id");
    const engine = stub("same-id");
    const source = new ForkTransitionPayloadSource(sessions, engine, forkSlot, 900);
    const handle = await source.prepare(request(), signal);
    vi.setSystemTime((forkSlot + 1) * 12_000);
    const payload = await source.getPayload(handle, signal);
    await expect(source.retainPrimaryPayload(handle, payload, signal)).rejects.toMatchObject({
      type: {code: "FORK_TRANSITION_PAYLOAD_RETAINED_UNSUPPORTED"},
    });
    expect(await source.renewOffer(payload, signal)).toBe(false);
    await source.releaseOffer(payload, signal);
    expect(sessions.retainPrimaryPayload).not.toHaveBeenCalled();
    expect(sessions.renewOffer).not.toHaveBeenCalled();
    expect(sessions.releaseOffer).not.toHaveBeenCalled();
    expect(engine.retainPrimaryPayload).not.toHaveBeenCalled();
    expect(engine.renewOffer).not.toHaveBeenCalled();
    expect(engine.releaseOffer).not.toHaveBeenCalled();
  });

  it("keeps a late cancelled native retention reply owned for cleanup", async () => {
    const sessions = stub("sessions");
    const source = new ForkTransitionPayloadSource(sessions, stub("engine"), forkSlot, 900);
    const handle = await source.prepare(request(forkSlot + 1), signal);
    const payload = await source.getPayload(handle, signal);
    const pending = defer<BuiltPayload>();
    sessions.retainPrimaryPayload.mockReturnValueOnce(pending.promise);
    const controller = new AbortController();
    const retaining = source.retainPrimaryPayload(handle, payload, controller.signal);
    controller.abort();
    const retained = {...payload, executionPayloadValue: 2n};
    pending.resolve(retained);
    expect(await retaining).toBe(retained);
    await source.release(handle, signal);
    await source.releaseOffer(retained, signal);
    expect(sessions.releaseOffer).toHaveBeenCalledExactlyOnceWith(retained, signal);
  });

  it("preserves a retained native snapshot through orchestrator cleanup and delegates generation rejection", async () => {
    const sessions = stub("sessions");
    const engine = stub("engine");
    const source = new ForkTransitionPayloadSource(sessions, engine, forkSlot, 900);
    const req = {...request(forkSlot + 1), requireRetainedOffer: true};
    const payload: BuiltPayload = {
      ...mockBuiltPayload({sourceId: sessions.id, slot: forkSlot + 1}),
      fork: ForkName.gloas,
      offerEligibility: {
        namespace: "fixture",
        generation: "0x4",
        lease: {generation: "0x4", ready: true, validUntil: Infinity, validUntilUnixMs: Infinity},
        retained: {
          id: "offer-fixture-1",
          namespace: "fixture",
          parentHash: req.forkchoiceState.headBlockHash,
          parentBeaconBlockRoot: toRootHex(req.payloadAttributes.parentBeaconBlockRoot),
          blockHash: toRootHex(mockBuiltPayload().executionPayload.blockHash),
          slot: `0x${(forkSlot + 1).toString(16)}`,
          closed: false,
        },
      },
    };
    sessions.getPayload.mockResolvedValue(payload);
    const orchestrator = new PayloadOrchestrator(source, {getPayloadTimeout: 1000}, signal);
    const accepted = vi.fn(async (built: BuiltPayload) => {
      expect(built).toBe(payload);
      return true;
    });
    const snapshot = expect(
      orchestrator.runSnapshot({id: "native-retained", request: req, getPayloadAt: Date.now() + 10}, accepted)
    ).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(10);
    await snapshot;
    expect(accepted).toHaveBeenCalledOnce();
    expect(sessions.release).toHaveBeenCalledOnce();
    expect(sessions.releaseOffer).not.toHaveBeenCalled();
    expect(await orchestrator.renewOffer(payload, signal)).toBe(true);
    sessions.renewOffer.mockResolvedValueOnce(false);
    expect(await orchestrator.renewOffer(payload, signal)).toBe(false);
    await orchestrator.releaseOffer(payload);
    expect(sessions.releaseOffer).toHaveBeenCalledOnce();
    expect(engine.prepare).not.toHaveBeenCalled();
    expect(engine.renewOffer).not.toHaveBeenCalled();
  });

  it("rejects foreign handles even when payload ids collide", async () => {
    const source = new ForkTransitionPayloadSource(stub("sessions"), stub("engine"), forkSlot, 900);
    const handle = await source.prepare(request(), signal);
    vi.setSystemTime(forkSlot * 12_000);
    await expect(source.getPayload({...handle}, signal)).rejects.toMatchObject({
      type: {code: ForkTransitionPayloadErrorCode.UNKNOWN_HANDLE},
    });
    await expect(source.release({...handle}, signal)).rejects.toMatchObject({
      type: {code: ForkTransitionPayloadErrorCode.UNKNOWN_HANDLE},
    });
  });

  it("rejects cancellation before allocation and retains a late handle for cleanup", async () => {
    const sessions = stub("sessions");
    const engine = stub("engine");
    const source = new ForkTransitionPayloadSource(sessions, engine, forkSlot, 900);
    const cancelled = AbortSignal.abort();
    await expect(source.prepare(request(), cancelled)).rejects.toBe(cancelled.reason);
    expect(engine.prepare).not.toHaveBeenCalled();
    const pending = defer<BuildHandle>();
    engine.prepare.mockReturnValue(pending.promise);
    const controller = new AbortController();
    const preparing = source.prepare(request(), controller.signal);
    controller.abort();
    const handle: BuildHandle = {sourceId: engine.id, fork: ForkName.gloas, payloadId: "late"};
    pending.resolve(handle);
    expect(await preparing).toBe(handle);
    await source.release(handle, signal);
    expect(engine.release).toHaveBeenCalledExactlyOnceWith(handle, signal);
  });

  it("does not cache a failed Engine read", async () => {
    const engine = stub("engine");
    const source = new ForkTransitionPayloadSource(stub("sessions"), engine, forkSlot, 900);
    const handle = await source.prepare(request(), signal);
    vi.setSystemTime(forkSlot * 12_000);
    engine.getPayload.mockRejectedValueOnce(new Error("connection closed"));
    await expect(source.getPayload(handle, signal)).rejects.toThrow("connection closed");
    const payload = await source.getPayload(handle, signal);
    expect(await source.getPayload(handle, signal)).toBe(payload);
    expect(engine.getPayload).toHaveBeenCalledTimes(2);
  });

  it.each([forkSlot, forkSlot + 1])(
    "publishes index zero at the configured deadline for proposal slot %i",
    async (slot) => {
      vi.setSystemTime((slot - 1) * 12_000);
      const sessions = stub("sessions");
      sessions.getResources.mockReturnValue({
        capacity: 2,
        active: 0,
        preparing: 0,
        releasing: 0,
        uncertain: 0,
        alternatesDisabled: false,
      });
      const engine = stub("engine");
      const selected = slot <= forkSlot ? engine : sessions;
      const unused = selected === engine ? sessions : engine;
      const source = new ForkTransitionPayloadSource(sessions, engine, forkSlot, 900 + 300);
      const payload = {...mockBuiltPayload({sourceId: selected.id, slot}), fork: ForkName.gloas as const};
      selected.getPayload.mockImplementation(async () => {
        await sleep(100);
        return payload;
      });
      const api = getApiClientStub();
      const dependentRoot = Buffer.alloc(32, 7);
      api.validator.getProposerDutiesV2.mockResolvedValue(
        mockApiResponse({
          data: [{slot, validatorIndex: 0, pubkey: Buffer.alloc(48)}],
          meta: {executionOptimistic: false, dependentRoot: toRootHex(dependentRoot)},
        })
      );
      api.beacon.publishExecutionPayloadBid.mockResolvedValue(mockApiResponse({}));
      const config = getConfig(ForkName.gloas);
      const clock = new ClockMock();
      clock.currentSlot = slot - 1;
      const secretKey = SecretKey.fromBytes(Buffer.alloc(32, 1));
      const tracker = new ProposerPreferencesTracker();
      const preferences = ssz.gloas.SignedProposerPreferences.defaultValue();
      preferences.message.proposalSlot = slot;
      preferences.message.dependentRoot = dependentRoot;
      tracker.onProposerPreferences(preferences);
      const store = new PayloadStore();
      const {bidder} = createBiddingModules({
        api,
        config,
        clock,
        logger: getMockedLogger(),
        builderSigner: new BuilderSigner(createBeaconConfig(config, Buffer.alloc(32)), {
          secretKey,
          publicKey: secretKey.toPublicKey(),
        }),
        proposerPreferencesTracker: tracker,
        payloadStore: store,
        payloadSource: source,
        signal,
        index: 0,
        updateOptions: {
          deadlineBps: 9250,
          updateIntervalMs: 25,
          updateCutoffBps: 2100,
          alternateBranches: true,
          alternateGossip: true,
          primaryHandoff: true,
          deferUnusedGossipStages: true,
        },
      });
      const data = ssz.gloas.SSEPayloadAttributes.defaultValue();
      data.proposalSlot = slot;
      data.parentBlockHash = payload.executionPayload.parentHash;
      data.payloadAttributes = {...request(slot).payloadAttributes, prevRandao: payload.executionPayload.prevRandao};
      const bidding = bidder.onPayloadAttributes({version: ForkName.gloas, data});
      await vi.advanceTimersByTimeAsync(12_000 - 900 - 1);
      expect(selected.getPayload).toHaveBeenCalled();
      expect(api.beacon.publishExecutionPayloadBid).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(api.beacon.publishExecutionPayloadBid).toHaveBeenCalledOnce();
      expect(api.beacon.publishExecutionPayloadBid.mock.calls[0][0].signedExecutionPayloadBid.message).toMatchObject({
        builderIndex: 0,
        slot,
        blockHash: payload.executionPayload.blockHash,
      });
      await vi.advanceTimersByTimeAsync(900 + config.getSlotComponentDurationMs(ForkName.gloas, 2100));
      await bidding;
      expect(api.beacon.publishExecutionPayloadBid).toHaveBeenCalledOnce();
      if (selected === engine) expect(engine.getPayload).toHaveBeenCalledOnce();
      expect(selected.release).toHaveBeenCalledOnce();
      expect(unused.prepare).not.toHaveBeenCalled();
      expect(store.has(toRootHex(payload.executionPayload.blockHash))).toBe(true);
    }
  );

  it("keeps Engine construction running until its deadline through the actual update orchestrator", async () => {
    const sessions = stub("sessions");
    const engine = stub("engine");
    const source = new ForkTransitionPayloadSource(sessions, engine, forkSlot, 900);
    const orchestrator = new PayloadOrchestrator(source, {getPayloadTimeout: 1000}, signal);
    const at = forkSlot * 12_000 - 900;
    const onPayload = vi.fn(async (_payload: BuiltPayload) => {});
    const updating = orchestrator.runUpdates(
      {id: "fork", request: request(), getPayloadAt: at},
      {intervalMs: 25, until: at + 100},
      onPayload
    );
    await vi.advanceTimersByTimeAsync(at - Date.now() - 1);
    expect(engine.prepare).toHaveBeenCalledOnce();
    expect(engine.getPayload).not.toHaveBeenCalled();
    expect(onPayload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(101);
    await updating;
    expect(engine.getPayload).toHaveBeenCalledOnce();
    expect(onPayload).toHaveBeenCalledOnce();
    expect(engine.release).toHaveBeenCalledOnce();
    expect(sessions.prepare).not.toHaveBeenCalled();
  });
});
