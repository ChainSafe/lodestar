import {createHash} from "node:crypto";
import {once} from "node:events";
import {createServer} from "node:http";
import {RLP} from "@ethereumjs/rlp";
import {describe, expect, it, vi} from "vitest";
import {
  type EngineApiRpcReturnTypes,
  ErrorJsonRpcResponse,
  JsonRpcHttpClient,
  serializePayloadAttributes,
} from "@lodestar/beacon-node";
import {type BuildRequest, PayloadSourceNotReady} from "@lodestar/builder";
import {ForkName} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {ErrorAborted, FetchError, type Logger, defer, sleep, toHex, toRootHex} from "@lodestar/utils";
import {
  PayloadOrchestrator,
  PayloadOrchestratorErrorCode,
} from "../../../../../builder/src/services/payloadOrchestrator.js";
import {SessionPayloadErrorCode, SessionPayloadSource} from "../../../../src/cmds/builder/sessionPayloadSource.js";

type PayloadResponse = EngineApiRpcReturnTypes["engine_getPayloadV6"];

function buildRequest(): BuildRequest {
  return {
    fork: ForkName.gloas,
    forkchoiceState: {
      headBlockHash: toRootHex(Buffer.alloc(32, 1)),
      safeBlockHash: toRootHex(Buffer.alloc(32, 2)),
      finalizedBlockHash: toRootHex(Buffer.alloc(32, 3)),
    },
    payloadAttributes: {
      ...ssz.gloas.PayloadAttributes.defaultValue(),
      timestamp: 1_787_212_236,
      slotNumber: 12,
      targetGasLimit: 200_000_000n,
      suggestedFeeRecipient: "0x" + "11".repeat(20),
      prevRandao: Buffer.alloc(32, 4),
      parentBeaconBlockRoot: Buffer.alloc(32, 5),
      withdrawals: [{index: 1, validatorIndex: 2, address: Buffer.alloc(20, 6), amount: 3n}],
    },
  };
}

function payloadResponse(request: BuildRequest, transactions = ["0x01aa", "0x02bb"]): PayloadResponse {
  const attrs = serializePayloadAttributes(request.payloadAttributes);
  return {
    executionPayload: {
      parentHash: request.forkchoiceState.headBlockHash,
      feeRecipient: attrs.suggestedFeeRecipient,
      stateRoot: "0x" + "22".repeat(32),
      receiptsRoot: "0x" + "33".repeat(32),
      logsBloom: "0x" + "00".repeat(256),
      prevRandao: attrs.prevRandao,
      blockNumber: "0x1",
      gasLimit: "0xbebc200",
      gasUsed: "0x1234",
      timestamp: attrs.timestamp,
      extraData: "0x",
      baseFeePerGas: "0x7",
      blockHash: "0x" + "44".repeat(32),
      transactions,
      withdrawals: attrs.withdrawals,
      blobGasUsed: "0x0",
      excessBlobGas: "0x0",
      blockAccessList: "0xc0",
      slotNumber: attrs.slotNumber,
    },
    blockValue: "0x10000000000000001",
    blobsBundle: {blobs: [], proofs: [], commitments: []},
    executionRequests: [],
    shouldOverrideBuilder: false,
  };
}

describe("SessionPayloadSource", () => {
  const signal = new AbortController().signal;
  function setup(
    boundedAlternates = false,
    beginReservations = false,
    retainedAlternateOffers = false,
    primaryHandoff = false
  ) {
    const rpc = new JsonRpcHttpClient(["http://127.0.0.1:1"]);
    const fetch = vi.spyOn(rpc, "fetch");
    const warn = vi.fn<Logger["warn"]>();
    const signals: AbortSignal[] = [];
    const source = new SessionPayloadSource(
      "session",
      (callSignal) => {
        signals.push(callSignal);
        return rpc;
      },
      {boundedAlternates, beginReservations, retainedAlternateOffers, primaryHandoff, logger: {warn}}
    );
    return {source, fetch, signals, warn, request: buildRequest()};
  }

  describe("retained alternate offers", () => {
    const instance = "ab".repeat(16);
    const session = `native-${instance}-0-1`;
    const alternate = `native-${instance}-1-2`;
    const offerId = `offer-${instance}-1`;
    const capabilities = {orderGenerationVersion: 1, retainedOfferVersion: 1};
    function grant(request: BuildRequest) {
      const payload = payloadResponse(request);
      return {
        retainedOfferVersion: 1,
        offerId,
        namespace: `0x${"cd".repeat(16)}`,
        generation: "0x0",
        currentGeneration: "0x0",
        leaseMs: 250,
        ready: true,
        parentHash: request.forkchoiceState.headBlockHash,
        parentBeaconBlockRoot: toHex(request.payloadAttributes.parentBeaconBlockRoot),
        blockHash: payload.executionPayload.blockHash,
        slot: `0x${request.payloadAttributes.slotNumber.toString(16)}`,
        payload,
      };
    }
    describe("primary handoff", () => {
      async function primary(
        enabled = true,
        capable = true,
        reserved = false,
        readOverrides: Record<string, unknown> = {}
      ) {
        const m = setup(true, reserved, true, enabled);
        const id = reserved ? `begin-${instance}-1` : session;
        const caps = {...capabilities, ...(capable ? {primaryHandoffVersion: 1} : {})};
        if (reserved) m.fetch.mockResolvedValueOnce({reservationId: id, beginReservationVersion: 1});
        m.fetch.mockResolvedValueOnce({
          sessionId: id,
          ...caps,
          ...(reserved ? {beginReservationVersion: 1, alternateSessionVersion: 0} : {}),
        });
        const handle = await m.source.prepare(m.request, signal);
        m.fetch.mockResolvedValueOnce({
          generation: "0x0",
          namespace: grant(m.request).namespace,
          leaseMs: 250,
          ready: true,
          payload: payloadResponse(m.request),
          ...readOverrides,
        });
        const payload = await m.source.getPayload(handle, signal);
        return {...m, handle, payload};
      }

      it("preserves exact order metadata through conditional reads, primary handoff and renewals", async () => {
        const orderMetadata = {version: 1, orderIds: [`0x${"12".repeat(32)}`], doNotOfferBefore: 0};
        const m = await primary(true, true, false, {orderMetadata});
        m.fetch.mockResolvedValueOnce({
          generation: "0x0",
          namespace: grant(m.request).namespace,
          leaseMs: 250,
          ready: true,
          payload: null,
          orderMetadata,
        });
        const unchanged = await m.source.getPayload(m.handle, signal);
        expect(unchanged.orderMetadata).toEqual(orderMetadata);
        const {payload: _payload, ...permission} = grant(m.request);
        m.fetch.mockResolvedValueOnce({...permission, orderMetadata});
        const retained = await m.source.retainPrimaryPayload(m.handle, unchanged, signal);
        expect(retained.orderMetadata).toEqual(orderMetadata);
        m.fetch.mockResolvedValueOnce({...permission, orderMetadata});
        expect(await m.source.renewOffer(retained, signal)).toBe(true);
        m.fetch.mockResolvedValueOnce({...permission, orderMetadata: {...orderMetadata, orderIds: []}});
        await expect(m.source.renewOffer(retained, signal)).rejects.toMatchObject({
          type: {code: SessionPayloadErrorCode.RESPONSE_MISMATCH, reason: "Retained order metadata changed"},
        });
        expect(retained.offerEligibility?.lease.ready).toBe(false);
      });

      it("rejects changed conditional membership and too-early reads without signing permission", async () => {
        const orderMetadata = {version: 1, orderIds: [`0x${"12".repeat(32)}`], doNotOfferBefore: 0};
        const m = await primary(true, true, false, {orderMetadata});
        m.fetch.mockResolvedValueOnce({
          generation: "0x0",
          namespace: grant(m.request).namespace,
          leaseMs: 250,
          ready: true,
          payload: null,
          orderMetadata: {...orderMetadata, orderIds: []},
        });
        await expect(m.source.getPayload(m.handle, signal)).rejects.toMatchObject({
          type: {
            code: SessionPayloadErrorCode.RESPONSE_MISMATCH,
            reason: "Order metadata changed for unchanged payload",
          },
        });
        expect(m.payload.offerEligibility?.lease.ready).toBe(false);
        await expect(
          primary(true, true, false, {orderMetadata: {...orderMetadata, doNotOfferBefore: Date.now() + 60_000}})
        ).rejects.toBeInstanceOf(PayloadSourceNotReady);
      });

      it.each([undefined, null, "0x01", 1, true, `0x${"CD".repeat(16)}`])(
        "keeps a primary payload available with optional namespace %j",
        async (namespace) => {
          const m = await primary(true, true, false, {namespace});
          expect(m.payload.offerEligibility?.lease.ready).toBe(true);
          expect(m.payload.offerEligibility?.namespace).toBeUndefined();
          expect(m.source.getResources()?.active).toBe(1);
          const calls = m.fetch.mock.calls.length;
          await expect(m.source.retainPrimaryPayload(m.handle, m.payload, signal)).rejects.toMatchObject({
            type: {code: SessionPayloadErrorCode.ALTERNATE_UNSUPPORTED},
          });
          expect(m.fetch).toHaveBeenCalledTimes(calls);
        }
      );

      it.each([undefined, null, "malformed", `0x${"ef".repeat(16)}`])(
        "keeps conditional primary bytes without rebinding an old snapshot to namespace %j",
        async (namespace) => {
          const m = await primary();
          const oldNamespace = m.payload.offerEligibility?.namespace;
          m.fetch.mockResolvedValueOnce({generation: "0x0", namespace, leaseMs: 250, ready: true, payload: null});
          const current = await m.source.getPayload(m.handle, signal);
          expect(current.executionPayload).toBe(m.payload.executionPayload);
          expect(current.offerEligibility?.lease.ready).toBe(true);
          expect(current.offerEligibility?.namespace).toBeUndefined();
          expect(m.payload.offerEligibility?.namespace).toBe(oldNamespace);
          const calls = m.fetch.mock.calls.length;
          for (const snapshot of [m.payload, current])
            await expect(m.source.retainPrimaryPayload(m.handle, snapshot, signal)).rejects.toMatchObject({
              type: {code: SessionPayloadErrorCode.ALTERNATE_UNSUPPORTED},
            });
          expect(m.fetch).toHaveBeenCalledTimes(calls);
          m.fetch.mockResolvedValueOnce({
            generation: "0x0",
            namespace: grant(m.request).namespace,
            leaseMs: 250,
            ready: true,
            payload: null,
          });
          const conditional = await m.source.getPayload(m.handle, signal);
          expect(conditional.executionPayload).toBe(m.payload.executionPayload);
          expect(conditional.offerEligibility?.namespace).toBeUndefined();
          m.fetch.mockResolvedValueOnce({
            generation: "0x0",
            namespace: grant(m.request).namespace,
            leaseMs: 250,
            ready: true,
            payload: payloadResponse(m.request),
          });
          const refreshed = await m.source.getPayload(m.handle, signal);
          const {payload: _payload, ...permission} = grant(m.request);
          m.fetch.mockResolvedValueOnce(permission);
          await expect(m.source.retainPrimaryPayload(m.handle, refreshed, signal)).resolves.toMatchObject({
            offerEligibility: {retained: {id: offerId}},
          });
        }
      );

      it("still rejects a wrong parent when the optional namespace is absent", async () => {
        const payload = payloadResponse(buildRequest());
        payload.executionPayload.parentHash = `0x${"99".repeat(32)}`;
        await expect(primary(true, true, false, {namespace: null, payload})).rejects.toMatchObject({
          type: {code: SessionPayloadErrorCode.RESPONSE_MISMATCH},
        });
      });

      it.each([{generation: "0x00"}, {leaseMs: 251}, {ready: "true"}])(
        "still rejects malformed required lease fields with an absent namespace: %j",
        async (fields) => {
          await expect(primary(true, true, false, {namespace: null, ...fields})).rejects.toMatchObject({
            type: {code: SessionPayloadErrorCode.RESPONSE_MISMATCH},
          });
        }
      );

      it.each([false, true])(
        "retains exact bytes independently of the primary worker (reserved %s)",
        async (reserved) => {
          const m = await primary(true, true, reserved);
          expect(m.source.supportsPrimaryHandoff).toBe(true);
          const {payload: _payload, ...permission} = grant(m.request);
          m.fetch.mockResolvedValueOnce(permission);
          const retained = await m.source.retainPrimaryPayload(m.handle, m.payload, signal);
          expect(retained.executionPayload).toBe(m.payload.executionPayload);
          expect(retained.executionRequests).toBe(m.payload.executionRequests);
          expect(retained.blobsBundle).toBe(m.payload.blobsBundle);
          expect(retained.offerEligibility?.lease).not.toBe(m.payload.offerEligibility?.lease);
          expect(m.fetch).toHaveBeenLastCalledWith(
            {
              method: "zbuilder_retainPrimaryPayloadV1",
              params: [
                m.handle.payloadId,
                {
                  namespace: permission.namespace,
                  generation: "0x0",
                  slot: permission.slot,
                  parentHash: permission.parentHash,
                  parentBeaconBlockRoot: permission.parentBeaconBlockRoot,
                  blockHash: permission.blockHash,
                },
              ],
            },
            {timeout: 25}
          );
          m.fetch.mockResolvedValueOnce(reserved ? {released: true, beginReservationVersion: 1} : true);
          await m.source.release(m.handle, signal);
          expect(m.payload.offerEligibility?.lease.ready).toBe(false);
          expect(retained.offerEligibility?.lease.ready).toBe(true);
          m.fetch.mockResolvedValueOnce(permission);
          expect(await m.source.renewOffer(retained, signal)).toBe(true);
          m.fetch.mockResolvedValueOnce({...permission, currentGeneration: "0x1", ready: false, leaseMs: 0});
          expect(await m.source.renewOffer(retained, signal)).toBe(false);
          expect(retained.offerEligibility?.retained?.closed).toBe(true);
        }
      );

      it.each([
        [false, true],
        [true, false],
      ])("requires explicit opt-in %s and native capability %s", async (enabled, capable) => {
        const m = await primary(enabled, capable);
        expect(m.source.supportsPrimaryHandoff).toBe(false);
        const count = m.fetch.mock.calls.length;
        await expect(m.source.retainPrimaryPayload(m.handle, m.payload, signal)).rejects.toMatchObject({
          type: {code: SessionPayloadErrorCode.ALTERNATE_UNSUPPORTED},
        });
        expect(m.fetch).toHaveBeenCalledTimes(count);
      });

      it.each(["namespace", "parentHash", "parentBeaconBlockRoot", "blockHash", "generation", "slot"] as const)(
        "releases a known token if returned %s differs",
        async (field) => {
          const m = await primary();
          const {payload: _payload, ...permission} = grant(m.request);
          m.fetch.mockResolvedValueOnce({...permission, [field]: "0x99"}).mockResolvedValueOnce(true);
          await expect(m.source.retainPrimaryPayload(m.handle, m.payload, signal)).rejects.toMatchObject({
            type: {code: SessionPayloadErrorCode.RESPONSE_MISMATCH},
          });
          expect(m.fetch).toHaveBeenLastCalledWith(
            {method: "zbuilder_releasePayloadOfferV1", params: [offerId]},
            {timeout: 1000}
          );
        }
      );

      it("never retries a lost grant response and still releases the worker", async () => {
        const m = await primary();
        m.fetch.mockRejectedValueOnce(new Error("lost response"));
        await expect(m.source.retainPrimaryPayload(m.handle, m.payload, signal)).rejects.toThrow("lost response");
        const count = m.fetch.mock.calls.length;
        await expect(m.source.retainPrimaryPayload(m.handle, m.payload, signal)).rejects.toMatchObject({
          type: {code: SessionPayloadErrorCode.ALTERNATE_UNSUPPORTED},
        });
        expect(m.fetch).toHaveBeenCalledTimes(count);
        m.fetch.mockResolvedValueOnce(true);
        await m.source.release(m.handle, signal);
        expect(m.source.getResources()?.active).toBe(0);
      });

      it("releases a late known grant after caller cancellation", async () => {
        const m = await primary();
        const controller = new AbortController();
        const {payload: _payload, ...permission} = grant(m.request);
        m.fetch
          .mockImplementationOnce(async () => {
            controller.abort();
            return permission;
          })
          .mockResolvedValueOnce(true);
        await expect(m.source.retainPrimaryPayload(m.handle, m.payload, controller.signal)).rejects.toBeDefined();
        expect(m.fetch).toHaveBeenLastCalledWith(
          {method: "zbuilder_releasePayloadOfferV1", params: [offerId]},
          {timeout: 1000}
        );
        expect(m.payload.offerEligibility?.lease.ready).toBe(true);
      });

      it("does not release an untrusted foreign-instance token", async () => {
        const m = await primary();
        m.fetch.mockResolvedValueOnce({...grant(m.request), offerId: `offer-${"ef".repeat(16)}-1`});
        await expect(m.source.retainPrimaryPayload(m.handle, m.payload, signal)).rejects.toMatchObject({
          type: {code: SessionPayloadErrorCode.RESPONSE_MISMATCH},
        });
        expect(m.fetch.mock.calls.some(([call]) => call.method === "zbuilder_releasePayloadOfferV1")).toBe(false);
      });
    });

    async function prepared() {
      const m = setup(true, false, true);
      m.fetch.mockResolvedValueOnce({sessionId: session, ...capabilities});
      await m.source.prepare(m.request, signal);
      m.fetch.mockResolvedValueOnce({sessionId: alternate, ...capabilities, alternateSessionVersion: 2});
      const handle = await m.source.prepare({...m.request, requireRetainedOffer: true}, signal);
      expect(m.fetch).toHaveBeenLastCalledWith(
        {
          method: "zbuilder_beginAlternateV2",
          params: [m.request.forkchoiceState.headBlockHash, serializePayloadAttributes(m.request.payloadAttributes)],
        },
        {timeout: 20_000}
      );
      return {...m, handle};
    }

    it.each([false, true])("requires opt-in and the native capability (option %s)", async (enabled) => {
      const {source, fetch, request} = setup(true, false, enabled);
      fetch.mockResolvedValueOnce({sessionId: session, ...(enabled ? {orderGenerationVersion: 1} : capabilities)});
      await source.prepare(request, signal);
      expect(source.supportsRetainedOffers).toBe(false);
      await expect(source.prepare({...request, requireRetainedOffer: true}, signal)).rejects.toMatchObject({
        type: {code: SessionPayloadErrorCode.ALTERNATE_UNSUPPORTED},
      });
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it("keeps exact permission after worker release, but never renews an older generation", async () => {
      const {source, fetch, request, handle} = await prepared();
      fetch.mockResolvedValueOnce(grant(request));
      const payload = await source.getPayload(handle, signal);
      const bytes = toHex(payload.executionPayload.blockHash);
      fetch.mockResolvedValueOnce(true);
      await source.release(handle, signal);
      expect(source.getResources()).toMatchObject({active: 1, uncertain: 0});
      expect(payload.offerEligibility?.lease.ready).toBe(true);
      fetch.mockResolvedValueOnce(grant(request));
      expect(await source.renewOffer(payload, signal)).toBe(true);
      fetch.mockResolvedValueOnce({...grant(request), currentGeneration: "0x1", leaseMs: 0, ready: false});
      expect(await source.renewOffer(payload, signal)).toBe(false);
      expect(payload.offerEligibility?.retained?.closed).toBe(true);
      expect(payload.offerEligibility?.generation).toBe("0x0");
      const count = fetch.mock.calls.length;
      expect(await source.renewOffer(payload, signal)).toBe(false);
      expect(fetch).toHaveBeenCalledTimes(count);
      expect(toHex(payload.executionPayload.blockHash)).toBe(bytes);
      fetch.mockResolvedValue(true);
      await source.releaseOffer(payload, signal);
      await source.releaseOffer(payload, signal);
      expect(payload.offerEligibility?.lease.ready).toBe(false);
    });

    it("uses an explicit alternate reservation and verifies all capability versions", async () => {
      const {source, fetch, request} = setup(true, true, true);
      const first = `begin-${instance}-1`;
      const second = `begin-${instance}-2`;
      fetch.mockResolvedValueOnce({reservationId: first, beginReservationVersion: 1}).mockResolvedValueOnce({
        sessionId: first,
        beginReservationVersion: 1,
        alternateSessionVersion: 0,
        ...capabilities,
      });
      await source.prepare(request, signal);
      fetch.mockResolvedValueOnce({reservationId: second, beginReservationVersion: 1}).mockResolvedValueOnce({
        sessionId: second,
        beginReservationVersion: 1,
        alternateSessionVersion: 2,
        ...capabilities,
      });
      const handle = await source.prepare({...request, requireRetainedOffer: true}, signal);
      expect(handle.payloadId).toBe(second);
      expect(fetch.mock.calls[2][0]).toEqual({method: "zbuilder_reserveAlternateBeginV1", params: []});
      fetch.mockResolvedValueOnce({released: true, beginReservationVersion: 1});
      await source.release(handle, signal);
      expect(source.getResources()).toMatchObject({active: 1, uncertain: 0});
    });

    it("rejects a stale alternate capability and cleans the known worker", async () => {
      const {source, fetch, request} = setup(true, false, true);
      fetch.mockResolvedValueOnce({sessionId: session, ...capabilities});
      await source.prepare(request, signal);
      fetch
        .mockResolvedValueOnce({sessionId: alternate, ...capabilities, alternateSessionVersion: 1})
        .mockResolvedValueOnce(true);
      await expect(source.prepare({...request, requireRetainedOffer: true}, signal)).rejects.toMatchObject({
        type: {code: SessionPayloadErrorCode.ALTERNATE_UNSUPPORTED},
      });
      expect(source.getResources()).toMatchObject({active: 1, uncertain: 0, alternatesDisabled: true});
      expect(fetch).toHaveBeenLastCalledWith({method: "zbuilder_endV1", params: [alternate]});
    });

    it.each([
      {parentHash: `0x${"77".repeat(32)}`},
      {parentBeaconBlockRoot: `0x${"77".repeat(32)}`},
      {blockHash: `0x${"77".repeat(32)}`},
      {slot: "0xd"},
      {leaseMs: 251},
      {currentGeneration: "0x1"},
      {retainedOfferVersion: 2},
      {namespace: "0x00"},
    ])("rejects mismatched retained payload metadata %j", async (mutation) => {
      const {source, fetch, request, handle} = await prepared();
      fetch.mockResolvedValueOnce({...grant(request), ...mutation}).mockResolvedValueOnce(true);
      await expect(source.getPayload(handle, signal)).rejects.toMatchObject({
        type: {code: SessionPayloadErrorCode.RESPONSE_MISMATCH},
      });
      expect(fetch).toHaveBeenLastCalledWith(
        {method: "zbuilder_releasePayloadOfferV1", params: [offerId]},
        {timeout: 1000}
      );
    });

    it("rejects a foreign constructor token before creating permission", async () => {
      const {source, fetch, request, handle} = await prepared();
      fetch.mockResolvedValueOnce({...grant(request), offerId: `offer-${"ee".repeat(16)}-1`});
      await expect(source.getPayload(handle, signal)).rejects.toMatchObject({
        type: {code: SessionPayloadErrorCode.RESPONSE_MISMATCH},
      });
    });

    it("does not resurrect a released permission when an earlier renewal completes", async () => {
      const {source, fetch, request, handle} = await prepared();
      fetch.mockResolvedValueOnce(grant(request));
      const payload = await source.getPayload(handle, signal);
      const response = defer<ReturnType<typeof grant>>();
      fetch.mockReturnValueOnce(response.promise);
      const renewing = source.renewOffer(payload, signal);
      fetch.mockResolvedValueOnce(true);
      await source.releaseOffer(payload, signal);
      response.resolve(grant(request));
      expect(await renewing).toBe(false);
      expect(payload.offerEligibility?.lease.ready).toBe(false);
    });

    it.each([false, true])("discards an in-flight renewal across a context pause (resumed %s)", async (resumed) => {
      const {source, fetch, request, handle} = await prepared();
      fetch.mockResolvedValueOnce(grant(request));
      const payload = await source.getPayload(handle, signal);
      const eligibility = payload.offerEligibility;
      if (!eligibility?.retained) throw Error("Missing grant");
      const response = defer<ReturnType<typeof grant>>();
      fetch.mockReturnValueOnce(response.promise);
      const renewing = source.renewOffer(payload, signal);
      eligibility.retained.pauseEpoch = 1;
      eligibility.retained.paused = !resumed;
      eligibility.lease.ready = false;
      response.resolve(grant(request));
      expect(await renewing).toBe(false);
      expect(eligibility.lease.ready).toBe(false);
      eligibility.retained.paused = false;
      fetch.mockResolvedValueOnce(grant(request));
      expect(await source.renewOffer(payload, signal)).toBe(true);
    });

    it.each(["PayloadNotReady", "StaleOrderGeneration"])(
      "marks %s during initial acquisition as retryable",
      async (message) => {
        const {source, fetch, handle} = await prepared();
        fetch.mockRejectedValueOnce(
          new ErrorJsonRpcResponse(
            {jsonrpc: "2.0", id: 1, error: {code: -32000, message}},
            "zbuilder_getRetainedPayloadV1"
          )
        );
        await expect(source.getPayload(handle, signal)).rejects.toBeInstanceOf(PayloadSourceNotReady);
      }
    );

    it("recovers a slow initial transfer using a small exact-token renewal", async () => {
      const {source, fetch, request, handle} = await prepared();
      fetch.mockImplementationOnce(async () => {
        await sleep(270);
        return grant(request);
      });
      fetch.mockResolvedValueOnce(grant(request));
      const payload = await source.getPayload(handle, signal);
      expect(payload.offerEligibility?.lease.ready).toBe(true);
      expect(fetch).toHaveBeenLastCalledWith(
        {method: "zbuilder_renewPayloadOfferV1", params: [offerId]},
        {timeout: 250}
      );
    });

    it("does not hold physical capacity after confirmed cleanup, and preserves uncertain cleanup", async () => {
      const {source, fetch, request, handle} = await prepared();
      fetch.mockResolvedValueOnce(grant(request));
      const payload = await source.getPayload(handle, signal);
      fetch.mockRejectedValueOnce(new Error("lost end"));
      await expect(source.release(handle, signal)).rejects.toThrow("lost end");
      expect(source.getResources()).toMatchObject({active: 1, uncertain: 1});
      expect(payload.offerEligibility?.lease.ready).toBe(true);
      await expect(source.prepare({...request, requireRetainedOffer: true}, signal)).rejects.toMatchObject({
        type: {code: SessionPayloadErrorCode.CAPACITY},
      });
      fetch.mockResolvedValueOnce(true);
      await source.release(handle, signal);
      expect(source.getResources()).toMatchObject({active: 1, uncertain: 0});
    });
  });

  describe("reserved begins", () => {
    const ticket = (counter = 1) => `begin-${"ab".repeat(16)}-${counter}`;
    const reservation = (counter = 1) => ({reservationId: ticket(counter), beginReservationVersion: 1});
    const begun = (counter = 1, alternate = false) => ({
      sessionId: ticket(counter),
      beginReservationVersion: 1,
      orderGenerationVersion: 0,
      alternateSessionVersion: alternate ? 1 : 0,
    });
    const released = {released: true, beginReservationVersion: 1};

    it.each(["before", "after"])(
      "recovers a lost release reply %s the next primary prepares without waiting for another head",
      async (failureOrder) => {
        vi.useFakeTimers({toFake: ["setTimeout", "clearTimeout", "performance"]});
        try {
          const {source, fetch, request} = setup(true, true, true);
          const firstCancel = defer<typeof released>();
          const confirmed = defer<typeof released>();
          let reservations = 0;
          let cancels = 0;
          fetch.mockImplementation(async (call) => {
            if (call.method === "zbuilder_reserveBeginV1" || call.method === "zbuilder_reserveAlternateBeginV1")
              return reservation(++reservations);
            if (call.method === "zbuilder_beginReservedV1")
              return {
                ...begun(reservations),
                orderGenerationVersion: 1,
                retainedOfferVersion: 1,
                alternateSessionVersion: reservations === 3 ? 2 : 0,
              };
            return ++cancels === 1 ? firstCancel.promise : confirmed.promise;
          });
          const old = await source.prepare(request, signal);
          const release = source.release(old, signal);
          const settled = Promise.allSettled([release]);
          const next = {...request, payloadAttributes: {...request.payloadAttributes, slotNumber: 13}};
          if (failureOrder === "after") await source.prepare(next, signal);
          await vi.advanceTimersByTimeAsync(0);
          firstCancel.reject(transportError("UND_ERR_SOCKET"));
          await vi.advanceTimersByTimeAsync(0);
          if (failureOrder === "before") await source.prepare(next, signal);
          await vi.advanceTimersByTimeAsync(100);
          expect(cancels).toBe(2);
          expect(source.getResources()).toMatchObject({active: 1, releasing: 1, uncertain: 0});
          await expect(source.prepare({...next, requireRetainedOffer: true}, signal)).rejects.toMatchObject({
            type: {code: SessionPayloadErrorCode.CAPACITY},
          });
          confirmed.resolve(released);
          expect((await settled).map((result) => result.status)).toEqual(["fulfilled"]);
          expect(source.getResources()).toMatchObject({active: 1, releasing: 0, uncertain: 0});
          await source.prepare({...next, requireRetainedOffer: true}, signal);
          expect(source.getResources()).toMatchObject({active: 2, uncertain: 0});
          expect(reservations).toBe(3);
        } finally {
          vi.useRealTimers();
        }
      }
    );

    it("bounds failed release retries and shares the retry with concurrent cleanup callers", async () => {
      vi.useFakeTimers({toFake: ["setTimeout", "clearTimeout", "performance"]});
      try {
        const {source, fetch, request, signals} = setup(true, true);
        fetch.mockResolvedValueOnce(reservation()).mockResolvedValueOnce(begun());
        const handle = await source.prepare(request, signal);
        const error = transportError("ECONNRESET");
        fetch.mockRejectedValue(error);
        const first = source.release(handle, signal);
        const second = source.release(handle, signal);
        const settled = Promise.allSettled([first, second]);
        await vi.advanceTimersByTimeAsync(99);
        expect(fetch).toHaveBeenCalledTimes(3);
        expect(source.getResources()).toMatchObject({active: 0, releasing: 1, uncertain: 0});
        await vi.advanceTimersByTimeAsync(1);
        expect((await settled).map((result) => result.status)).toEqual(["rejected", "rejected"]);
        expect(fetch).toHaveBeenCalledTimes(4);
        expect(signals.at(-1)).toBe(signals.at(-2));
        expect(source.getResources()).toMatchObject({active: 0, releasing: 0, uncertain: 1});
        await vi.advanceTimersByTimeAsync(10_000);
        expect(fetch).toHaveBeenCalledTimes(4);
        const reconcile = Promise.allSettled([source.reconcileResources(signal), source.reconcileResources(signal)]);
        await vi.advanceTimersByTimeAsync(100);
        expect((await reconcile).map((result) => result.status)).toEqual(["rejected", "rejected"]);
        expect(fetch).toHaveBeenCalledTimes(6);
        expect(source.getResources()).toMatchObject({uncertain: 1, releasing: 0});
        await vi.advanceTimersByTimeAsync(10_000);
        expect(fetch).toHaveBeenCalledTimes(6);
      } finally {
        vi.useRealTimers();
      }
    });

    it("confirms simultaneous failed releases independently without exceeding one retry per owner", async () => {
      vi.useFakeTimers({toFake: ["setTimeout", "clearTimeout", "performance"]});
      try {
        const {source, fetch, request} = setup(false, true);
        fetch
          .mockResolvedValueOnce(reservation())
          .mockResolvedValueOnce(begun())
          .mockResolvedValueOnce(reservation(2))
          .mockResolvedValueOnce(begun(2));
        const first = await source.prepare(request, signal);
        const second = await source.prepare(request, signal);
        const counts = new Map<string, number>();
        const firstProof = defer<typeof released>();
        fetch.mockImplementation(async (call) => {
          const id = String(Array.isArray(call.params) ? call.params[0] : "");
          const count = (counts.get(id) ?? 0) + 1;
          counts.set(id, count);
          if (count === 1) throw transportError("UND_ERR_SOCKET");
          return id === first.payloadId ? firstProof.promise : released;
        });
        const settled = Promise.allSettled([source.release(first, signal), source.release(second, signal)]);
        await vi.advanceTimersByTimeAsync(100);
        expect(counts).toEqual(
          new Map([
            [first.payloadId, 2],
            [second.payloadId, 2],
          ])
        );
        expect(source.getResources()).toMatchObject({active: 0, releasing: 1, uncertain: 0});
        firstProof.resolve(released);
        expect((await settled).map((result) => result.status)).toEqual(["fulfilled", "fulfilled"]);
        expect(source.getResources()).toMatchObject({active: 0, releasing: 0, uncertain: 0});
      } finally {
        vi.useRealTimers();
      }
    });

    it("retries a release while sibling reconciliation is running without waiting on itself", async () => {
      vi.useFakeTimers({toFake: ["setTimeout", "clearTimeout", "performance"]});
      try {
        const {source, fetch, request} = setup(false, true);
        fetch
          .mockResolvedValueOnce(reservation())
          .mockResolvedValueOnce(begun())
          .mockResolvedValueOnce(reservation(2))
          .mockResolvedValueOnce(begun(2));
        const first = await source.prepare(request, signal);
        const second = await source.prepare(request, signal);
        fetch.mockRejectedValueOnce(new Error("existing uncertain owner"));
        await expect(source.release(first, signal)).rejects.toThrow("existing uncertain owner");
        const firstProof = defer<typeof released>();
        let secondCancels = 0;
        fetch.mockImplementation(async (call) => {
          if (Array.isArray(call.params) && call.params[0] === first.payloadId) return firstProof.promise;
          if (++secondCancels === 1) throw transportError("ECONNRESET");
          return released;
        });
        const reconciliation = source.reconcileResources(signal);
        const release = source.release(second, signal);
        const settled = Promise.allSettled([release]);
        await vi.advanceTimersByTimeAsync(100);
        expect((await settled).map((result) => result.status)).toEqual(["fulfilled"]);
        expect(secondCancels).toBe(2);
        expect(source.getResources()).toMatchObject({active: 0, releasing: 1, uncertain: 0});
        firstProof.resolve(released);
        await reconciliation;
        expect(source.getResources()).toMatchObject({active: 0, releasing: 0, uncertain: 0});
      } finally {
        vi.useRealTimers();
      }
    });

    it("does not retry a release after its cleanup signal is aborted during the pacing delay", async () => {
      vi.useFakeTimers({toFake: ["setTimeout", "clearTimeout", "performance"]});
      try {
        const {source, fetch, request} = setup(false, true);
        fetch.mockResolvedValueOnce(reservation()).mockResolvedValueOnce(begun());
        const handle = await source.prepare(request, signal);
        fetch.mockRejectedValue(transportError("UND_ERR_SOCKET"));
        const controller = new AbortController();
        const settled = Promise.allSettled([source.release(handle, controller.signal)]);
        await vi.advanceTimersByTimeAsync(50);
        controller.abort();
        await vi.advanceTimersByTimeAsync(100);
        expect((await settled).map((result) => result.status)).toEqual(["rejected"]);
        expect(fetch).toHaveBeenCalledTimes(3);
        expect(source.getResources()).toMatchObject({active: 0, releasing: 0, uncertain: 1});
      } finally {
        vi.useRealTimers();
      }
    });

    it("does not replenish the transport retry after an intermediate pending-cancellation reply", async () => {
      vi.useFakeTimers({toFake: ["setTimeout", "clearTimeout", "performance"]});
      try {
        const {source, fetch, request} = setup(false, true);
        fetch.mockResolvedValueOnce(reservation()).mockResolvedValueOnce(begun());
        const handle = await source.prepare(request, signal);
        fetch
          .mockRejectedValueOnce(transportError("UND_ERR_SOCKET"))
          .mockResolvedValueOnce({...released, released: false})
          .mockRejectedValueOnce(transportError("ECONNRESET"));
        const settled = Promise.allSettled([source.release(handle, signal)]);
        await vi.advanceTimersByTimeAsync(200);
        expect((await settled).map((result) => result.status)).toEqual(["rejected"]);
        expect(fetch).toHaveBeenCalledTimes(5);
        expect(source.getResources()).toMatchObject({uncertain: 1, releasing: 0});
        await vi.advanceTimersByTimeAsync(10_000);
        expect(fetch).toHaveBeenCalledTimes(5);
      } finally {
        vi.useRealTimers();
      }
    });

    it.each([
      new SyntaxError("invalid response JSON"),
      new TypeError("input failure", {cause: Object.assign(new Error("invalid"), {code: "ERR_INVALID_INPUT"})}),
      new Error("application failure", {cause: Object.assign(new Error("closed"), {code: "UND_ERR_SOCKET"})}),
    ])("does not retry unclassified release failures: %s", async (error) => {
      const {source, fetch, request} = setup(false, true);
      fetch.mockResolvedValueOnce(reservation()).mockResolvedValueOnce(begun());
      const handle = await source.prepare(request, signal);
      fetch.mockRejectedValueOnce(error);
      await expect(source.release(handle, signal)).rejects.toBe(error);
      expect(fetch).toHaveBeenCalledTimes(3);
      expect(source.getResources()).toMatchObject({active: 0, releasing: 0, uncertain: 1});
    });

    it.each(["before-headers", "during-body"])(
      "recovers an actual cancel connection closed %s after the next primary is ready",
      async (phase) => {
        const cancellationReceived = defer<void>();
        const closeFirstReply = defer<void>();
        const confirmSecondReply = defer<void>();
        let reservations = 0;
        let cancellations = 0;
        const server = createServer(async (req, res) => {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(Buffer.from(chunk));
          const call = JSON.parse(Buffer.concat(chunks).toString()) as {id: number; method: string};
          let result: unknown;
          if (call.method === "zbuilder_reserveBeginV1") result = reservation(++reservations);
          else if (call.method === "zbuilder_beginReservedV1") result = begun(reservations);
          else {
            cancellations++;
            if (cancellations === 1) {
              cancellationReceived.resolve();
              await closeFirstReply.promise;
              if (phase === "during-body") {
                res.writeHead(200, {"content-type": "application/json"});
                res.write(`{"jsonrpc":"2.0","id":${call.id},"result":`);
                await sleep(20);
              }
              res.destroy();
              return;
            }
            await confirmSecondReply.promise;
            result = released;
          }
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({jsonrpc: "2.0", id: call.id, result}));
        });
        server.listen(0, "127.0.0.1");
        await once(server, "listening");
        const address = server.address();
        if (!address || typeof address === "string") throw new Error("Missing local test address");
        const source = new SessionPayloadSource(
          "session",
          (callSignal) => new JsonRpcHttpClient([`http://127.0.0.1:${address.port}`], {signal: callSignal}),
          {boundedAlternates: true, beginReservations: true}
        );
        try {
          const request = buildRequest();
          const old = await source.prepare(request, signal);
          const cleanup = source.release(old, signal);
          const settled = Promise.allSettled([cleanup]);
          await cancellationReceived.promise;
          await source.prepare({...request, payloadAttributes: {...request.payloadAttributes, slotNumber: 13}}, signal);
          closeFirstReply.resolve();
          await vi.waitFor(() => expect(cancellations).toBe(2));
          expect(source.getResources()).toMatchObject({active: 1, releasing: 1, uncertain: 0});
          confirmSecondReply.resolve();
          expect((await settled).map((result) => result.status)).toEqual(["fulfilled"]);
          expect(source.getResources()).toMatchObject({active: 1, releasing: 0, uncertain: 0});
          expect(reservations).toBe(2);
        } finally {
          closeFirstReply.resolve();
          confirmSecondReply.resolve();
          server.closeAllConnections();
          await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
        }
      }
    );

    it("allows tracked primary cleanup to finish beyond one second without enabling alternates", async () => {
      const {source, fetch, request, signals} = setup(false, true);
      fetch
        .mockResolvedValueOnce(reservation())
        .mockResolvedValueOnce(begun())
        .mockResolvedValueOnce(payloadResponse(request))
        .mockImplementationOnce(async () => {
          await sleep(1500, signals.at(-1));
          return released;
        });
      const orchestrator = new PayloadOrchestrator(source, {getPayloadTimeout: 1000}, signal);
      await orchestrator.run({id: "reserved-primary", request, getPayloadAt: Date.now() + 50});
      expect(source.supportsBoundedAlternates).toBe(false);
      expect(fetch).toHaveBeenLastCalledWith({method: "zbuilder_cancelBeginV1", params: [ticket()]});
      expect(source.getResources()).toMatchObject({active: 0, uncertain: 0, releasing: 0, alternatesDisabled: false});
    });

    it("tracks reservations without enabling alternate work", async () => {
      const {source, fetch, request} = setup(false, true);
      expect(source.supportsBoundedAlternates).toBe(false);
      expect(source.getResources()).toMatchObject({capacity: 2, active: 0, uncertain: 0});
      await expect(source.prepare({...request, requireUnleased: true}, signal)).rejects.toMatchObject({
        type: {code: SessionPayloadErrorCode.ALTERNATE_UNSUPPORTED},
      });
      expect(fetch).not.toHaveBeenCalled();
    });

    it("disables unsupported alternate reservations without losing primary capacity", async () => {
      const {source, fetch, request, warn} = setup(true, true);
      fetch.mockResolvedValueOnce(reservation()).mockResolvedValueOnce(begun());
      await source.prepare(request, signal);
      fetch.mockRejectedValueOnce(
        new ErrorJsonRpcResponse(
          {jsonrpc: "2.0", id: 1, error: {code: -32000, message: "AlternateLeasesUnsupported"}},
          "zbuilder_reserveBeginV1"
        )
      );
      await expect(source.prepare({...request, requireUnleased: true}, signal)).rejects.toBeInstanceOf(
        ErrorJsonRpcResponse
      );
      expect(source.getResources()).toMatchObject({active: 1, uncertain: 0, preparing: 0, alternatesDisabled: true});
      expect(warn).toHaveBeenCalledWith(
        "Constructor alternate admission disabled",
        expect.objectContaining({reason: "unsupported_alternate_method", method: "zbuilder_reserveBeginV1"})
      );
      await expect(source.prepare({...request, requireUnleased: true}, signal)).rejects.toMatchObject({
        type: {code: SessionPayloadErrorCode.ALTERNATE_UNSUPPORTED},
      });
      expect(fetch).toHaveBeenCalledTimes(3);
    });

    it("cancels an alternate whose capabilities are unconfirmed before admitting new work", async () => {
      const {source, fetch, request, warn} = setup(true, true);
      fetch.mockResolvedValueOnce(reservation()).mockResolvedValueOnce(begun());
      await source.prepare(request, signal);
      fetch.mockResolvedValueOnce(reservation(2)).mockResolvedValueOnce(begun(2)).mockResolvedValueOnce(released);
      await expect(source.prepare({...request, requireUnleased: true}, signal)).rejects.toMatchObject({
        type: {code: SessionPayloadErrorCode.INVALID_SESSION},
      });
      await source.reconcileResources(signal);
      expect(source.getResources()).toMatchObject({active: 1, uncertain: 0, releasing: 0, alternatesDisabled: true});
      expect(fetch).toHaveBeenLastCalledWith({method: "zbuilder_cancelBeginV1", params: [ticket(2)]});
      expect(warn).toHaveBeenCalledWith(
        "Constructor alternate admission disabled",
        expect.objectContaining({reason: "unconfirmed_alternate_capability", method: "zbuilder_beginReservedV1"})
      );
    });

    it("rejects an alternate capability on a primary and releases its reservation", async () => {
      const {source, fetch, request} = setup(false, true);
      fetch.mockResolvedValueOnce(reservation()).mockResolvedValueOnce(begun(1, true)).mockResolvedValueOnce(released);
      await expect(source.prepare(request, signal)).rejects.toMatchObject({
        type: {code: SessionPayloadErrorCode.INVALID_SESSION},
      });
      await source.reconcileResources(signal);
      expect(source.getResources()).toMatchObject({active: 0, uncertain: 0, releasing: 0, alternatesDisabled: false});
    });

    it("reserves before begin and releases by ticket without invalidating payload bytes", async () => {
      const {source, fetch, request} = setup(false, true);
      fetch.mockResolvedValueOnce(reservation()).mockResolvedValueOnce(begun());
      const handle = await source.prepare(request, signal);
      expect(fetch).toHaveBeenNthCalledWith(1, {method: "zbuilder_reserveBeginV1", params: [false]}, {timeout: 1000});
      expect(fetch).toHaveBeenNthCalledWith(
        2,
        {
          method: "zbuilder_beginReservedV1",
          params: [
            ticket(),
            request.forkchoiceState.headBlockHash,
            serializePayloadAttributes(request.payloadAttributes),
          ],
        },
        {timeout: 20_000}
      );
      fetch.mockResolvedValueOnce(payloadResponse(request));
      const payload = await source.getPayload(handle, signal);
      const retained = toHex(payload.executionPayload.blockHash);
      fetch.mockResolvedValueOnce(released);
      await source.release(handle, signal);
      expect(fetch).toHaveBeenLastCalledWith({method: "zbuilder_cancelBeginV1", params: [ticket()]});
      expect(toHex(payload.executionPayload.blockHash)).toBe(retained);
      expect(source.getResources()).toMatchObject({
        preparing: 0,
        active: 0,
        uncertain: 0,
        releasing: 0,
        alternatesDisabled: false,
      });
    });

    it("does not reserve worker capacity after losing a reserve reply or retry legacy begin", async () => {
      const {source, fetch, request} = setup(true, true);
      fetch.mockRejectedValueOnce(new Error("reserve reply lost"));
      await expect(source.prepare(request, signal)).rejects.toThrow("reserve reply lost");
      expect(source.getResources()).toMatchObject({preparing: 0, uncertain: 0, alternatesDisabled: false});
      fetch.mockResolvedValueOnce(reservation(2)).mockResolvedValueOnce(begun(2));
      await source.prepare(request, signal);
      expect(fetch.mock.calls.map(([call]) => call.method)).toEqual([
        "zbuilder_reserveBeginV1",
        "zbuilder_reserveBeginV1",
        "zbuilder_beginReservedV1",
      ]);
    });

    it("keeps a lost begin counted until cancellation proves release, then admits alternates again", async () => {
      const {source, fetch, request} = setup(true, true);
      const cancel = defer<typeof released>();
      fetch.mockResolvedValueOnce(reservation()).mockResolvedValueOnce(begun());
      await source.prepare(request, signal);
      fetch
        .mockResolvedValueOnce(reservation(2))
        .mockRejectedValueOnce(new Error("begin reply lost"))
        .mockImplementationOnce(() => cancel.promise);
      await expect(source.prepare({...request, requireUnleased: true}, signal)).rejects.toThrow("begin reply lost");
      expect(source.getResources()).toMatchObject({
        preparing: 0,
        active: 1,
        releasing: 1,
        uncertain: 0,
        alternatesDisabled: false,
      });
      await expect(source.prepare(request, signal)).rejects.toMatchObject({
        type: {code: SessionPayloadErrorCode.CAPACITY},
      });
      cancel.resolve(released);
      await source.reconcileResources(signal);
      expect(source.getResources()).toMatchObject({active: 1, releasing: 0, uncertain: 0, alternatesDisabled: false});
      fetch.mockResolvedValueOnce(reservation(3)).mockResolvedValueOnce(begun(3, true));
      await source.prepare({...request, requireUnleased: true}, signal);
      expect(source.getResources()).toMatchObject({active: 2, uncertain: 0});
    });

    it("does not clear an uncertain ticket on a lost cancel reply", async () => {
      const {source, fetch, request} = setup(true, true);
      fetch.mockResolvedValueOnce(reservation()).mockResolvedValueOnce(begun());
      const handle = await source.prepare(request, signal);
      fetch.mockRejectedValueOnce(new Error("cancel reply lost"));
      await expect(source.release(handle, signal)).rejects.toThrow("cancel reply lost");
      expect(source.getResources()).toMatchObject({active: 0, uncertain: 1});
      fetch.mockResolvedValueOnce(released);
      await source.reconcileResources(signal);
      expect(source.getResources()).toMatchObject({uncertain: 0, alternatesDisabled: false});
    });

    it("coalesces cancellation and keeps polling while native work is draining", async () => {
      const {source, fetch, request} = setup(true, true);
      fetch.mockResolvedValueOnce(reservation()).mockResolvedValueOnce(begun());
      const handle = await source.prepare(request, signal);
      const cancel = defer<typeof released>();
      fetch.mockResolvedValueOnce({...released, released: false}).mockImplementationOnce(() => cancel.promise);
      const first = source.release(handle, signal);
      const second = source.release(handle, signal);
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(4));
      expect(source.getResources()).toMatchObject({releasing: 1, active: 0, uncertain: 0});
      cancel.resolve(released);
      await Promise.all([first, second]);
      expect(fetch.mock.calls.slice(2).map(([call]) => call.method)).toEqual([
        "zbuilder_cancelBeginV1",
        "zbuilder_cancelBeginV1",
      ]);
      expect(source.getResources()).toMatchObject({releasing: 0, uncertain: 0});
    });

    it.each([
      undefined,
      null,
      {},
      true,
      false,
      0,
      "true",
      {released: "true", beginReservationVersion: 1},
      {released: true, beginReservationVersion: 2},
    ])("retains capacity for a malformed cancellation confirmation %j", async (reply) => {
      const {source, fetch, request} = setup(true, true);
      fetch.mockResolvedValueOnce(reservation()).mockResolvedValueOnce(begun());
      const handle = await source.prepare(request, signal);
      fetch.mockResolvedValueOnce(reply);
      await expect(source.release(handle, signal)).rejects.toMatchObject({
        type: {code: SessionPayloadErrorCode.RELEASE_UNCONFIRMED},
      });
      expect(source.getResources()).toMatchObject({uncertain: 1, active: 0});
      expect(fetch).toHaveBeenCalledTimes(3);
    });

    it("does not treat another native instance or UnknownSession as release proof", async () => {
      const {source, fetch, request} = setup(true, true);
      fetch.mockResolvedValueOnce(reservation()).mockResolvedValueOnce(begun());
      const handle = await source.prepare(request, signal);
      for (const message of ["BeginReservationInstanceMismatch", "UnknownSession"]) {
        fetch.mockRejectedValueOnce(
          new ErrorJsonRpcResponse({jsonrpc: "2.0", id: 1, error: {code: -32000, message}}, "zbuilder_cancelBeginV1")
        );
        await expect(source.release(handle, signal)).rejects.toBeInstanceOf(ErrorJsonRpcResponse);
        expect(source.getResources()).toMatchObject({uncertain: 1});
      }
    });

    it("releases a second uncertain ticket despite a stale first instance", async () => {
      const {source, fetch, request} = setup(false, true);
      fetch
        .mockResolvedValueOnce(reservation())
        .mockResolvedValueOnce(begun())
        .mockResolvedValueOnce(reservation(2))
        .mockResolvedValueOnce(begun(2));
      const first = await source.prepare(request, signal);
      const second = await source.prepare(request, signal);
      const mismatch = new ErrorJsonRpcResponse(
        {jsonrpc: "2.0", id: 1, error: {code: -32000, message: "BeginReservationInstanceMismatch"}},
        "zbuilder_cancelBeginV1"
      );
      fetch.mockRejectedValue(new Error("lost cancellation response"));
      await Promise.allSettled([source.release(first, signal), source.release(second, signal)]);
      expect(source.getResources()).toMatchObject({uncertain: 2});
      fetch.mockImplementation(async (call) => {
        if (Array.isArray(call.params) && call.params[0] === first.payloadId) throw mismatch;
        return released;
      });
      await expect(source.reconcileResources(signal)).rejects.toBe(mismatch);
      expect(fetch.mock.calls.slice(-2).map(([call]) => call.params)).toEqual([[first.payloadId], [second.payloadId]]);
      expect(source.getResources()).toMatchObject({active: 0, releasing: 0, uncertain: 1});
      await expect(source.release(second, signal)).rejects.toMatchObject({
        type: {code: SessionPayloadErrorCode.UNKNOWN_HANDLE},
      });
      await expect(source.release(first, signal)).rejects.toBe(mismatch);
      expect(source.getResources()).toMatchObject({uncertain: 1});
    });

    it("coalesces both cleanup calls and preserves a hung ticket while releasing its sibling", async () => {
      const {source, fetch, request, signals} = setup(false, true);
      fetch
        .mockResolvedValueOnce(reservation())
        .mockResolvedValueOnce(begun())
        .mockResolvedValueOnce(reservation(2))
        .mockResolvedValueOnce(begun(2));
      const first = await source.prepare(request, signal);
      const second = await source.prepare(request, signal);
      fetch.mockRejectedValue(new Error("lost cancellation response"));
      await Promise.allSettled([source.release(first, signal), source.release(second, signal)]);
      const cleanupCalls: string[] = [];
      fetch.mockImplementation(async (call) => {
        const payloadId = Array.isArray(call.params) ? call.params[0] : undefined;
        cleanupCalls.push(String(payloadId));
        if (payloadId === first.payloadId) await sleep(10_000, signals.at(-1));
        return released;
      });
      const controller = new AbortController();
      const one = source.reconcileResources(controller.signal);
      const two = source.reconcileResources(signal);
      const settled = Promise.allSettled([one, two]);
      await vi.waitFor(() => expect(source.getResources()).toMatchObject({releasing: 1, uncertain: 0, active: 0}));
      expect(cleanupCalls).toEqual([first.payloadId, second.payloadId]);
      controller.abort();
      expect((await settled).map((result) => result.status)).toEqual(["rejected", "rejected"]);
      expect(source.getResources()).toMatchObject({releasing: 0, uncertain: 1, active: 0});
      expect(cleanupCalls).toHaveLength(2);
    });

    it("paces stale-instance cancellation without delaying a newly releasable ticket", async () => {
      vi.useFakeTimers({toFake: ["setTimeout", "clearTimeout", "performance"]});
      try {
        const {source, fetch, request} = setup(false, true);
        const mismatch = new ErrorJsonRpcResponse(
          {jsonrpc: "2.0", id: 1, error: {code: -32000, message: "BeginReservationInstanceMismatch"}},
          "zbuilder_cancelBeginV1"
        );
        fetch.mockResolvedValueOnce(reservation()).mockResolvedValueOnce(begun());
        const stale = await source.prepare(request, signal);
        fetch.mockRejectedValueOnce(mismatch);
        await expect(source.release(stale, signal)).rejects.toBe(mismatch);
        for (let i = 0; i < 20; i++) await source.reconcileResources(signal);
        expect(fetch).toHaveBeenCalledTimes(3);
        expect(source.getResources()).toMatchObject({uncertain: 1});

        fetch.mockResolvedValueOnce(reservation(2)).mockResolvedValueOnce(begun(2));
        const current = await source.prepare(request, signal);
        fetch.mockRejectedValueOnce(new Error("lost cancel reply"));
        await expect(source.release(current, signal)).rejects.toThrow("lost cancel reply");
        fetch.mockResolvedValueOnce(released);
        await source.reconcileResources(signal);
        expect(fetch).toHaveBeenLastCalledWith({method: "zbuilder_cancelBeginV1", params: [current.payloadId]});
        expect(fetch).toHaveBeenCalledTimes(7);
        expect(source.getResources()).toMatchObject({uncertain: 1, releasing: 0, active: 0});

        fetch.mockRejectedValue(mismatch);
        for (const [i, delay] of [200, 400, 800, 1000, 1000].entries()) {
          await vi.advanceTimersByTimeAsync(delay - 1);
          await source.reconcileResources(signal);
          expect(fetch).toHaveBeenCalledTimes(7 + i);
          await vi.advanceTimersByTimeAsync(1);
          await expect(source.reconcileResources(signal)).rejects.toBe(mismatch);
          expect(fetch).toHaveBeenCalledTimes(8 + i);
          expect(fetch).toHaveBeenLastCalledWith({method: "zbuilder_cancelBeginV1", params: [stale.payloadId]});
          expect(source.getResources()).toMatchObject({uncertain: 1, releasing: 0});
        }
      } finally {
        vi.useRealTimers();
      }
    });

    it("starts a newly uncertain begin's cleanup while its sibling's reconciliation is still pending", async () => {
      const {source, fetch, request} = setup(false, true);
      fetch.mockResolvedValueOnce(reservation()).mockResolvedValueOnce(begun());
      const first = await source.prepare(request, signal);
      fetch.mockRejectedValueOnce(new Error("lost cancel reply"));
      await expect(source.release(first, signal)).rejects.toThrow("lost cancel reply");
      const firstCleanup = defer<typeof released>();
      const secondBegin = defer<ReturnType<typeof begun>>();
      fetch.mockImplementation(async (call) => {
        if (call.method === "zbuilder_reserveBeginV1") return reservation(2);
        if (call.method === "zbuilder_beginReservedV1") return secondBegin.promise;
        if (Array.isArray(call.params) && call.params[0] === first.payloadId) return firstCleanup.promise;
        return released;
      });
      const second = source.prepare(request, signal);
      const rejected = expect(second).rejects.toThrow("begin reply lost");
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(6));
      secondBegin.reject(new Error("begin reply lost"));
      await rejected;
      await vi.waitFor(() => expect(source.getResources()).toMatchObject({preparing: 0, releasing: 1, uncertain: 0}));
      expect(fetch).toHaveBeenLastCalledWith({method: "zbuilder_cancelBeginV1", params: [ticket(2)]});
      expect(fetch).toHaveBeenCalledTimes(7);
      firstCleanup.resolve(released);
      await source.reconcileResources(signal);
      expect(source.getResources()).toMatchObject({preparing: 0, releasing: 0, uncertain: 0});
    });

    it("adds a newly failed release to pending cleanup on the next primary preparation", async () => {
      const {source, fetch, request} = setup(false, true);
      fetch
        .mockResolvedValueOnce(reservation())
        .mockResolvedValueOnce(begun())
        .mockResolvedValueOnce(reservation(2))
        .mockResolvedValueOnce(begun(2));
      const first = await source.prepare(request, signal);
      const second = await source.prepare(request, signal);
      fetch.mockRejectedValueOnce(new Error("first cancel reply lost"));
      await expect(source.release(first, signal)).rejects.toThrow("first cancel reply lost");
      const firstCleanup = defer<typeof released>();
      fetch.mockImplementationOnce(() => firstCleanup.promise);
      const cleanup = source.reconcileResources(signal);
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(6));

      fetch.mockRejectedValueOnce(new Error("second cancel reply lost"));
      await expect(source.release(second, signal)).rejects.toThrow("second cancel reply lost");
      expect(source.getResources()).toMatchObject({active: 0, releasing: 1, uncertain: 1});
      fetch.mockResolvedValueOnce(released);
      await expect(source.prepare(request, signal)).rejects.toMatchObject({
        type: {code: SessionPayloadErrorCode.CAPACITY},
      });
      await vi.waitFor(() => expect(source.getResources()).toMatchObject({active: 0, releasing: 1, uncertain: 0}));
      expect(fetch).toHaveBeenCalledTimes(8);
      expect(fetch.mock.calls.slice(4).map(([call]) => call.params)).toEqual([
        [first.payloadId],
        [first.payloadId],
        [second.payloadId],
        [second.payloadId],
      ]);
      firstCleanup.resolve(released);
      await cleanup;
      expect(source.getResources()).toMatchObject({active: 0, releasing: 0, uncertain: 0});
    });

    it("retains both same-slot rejected tickets until each cancellation confirms release", async () => {
      vi.useFakeTimers({toFake: ["setTimeout", "clearTimeout", "performance"]});
      try {
        const {source, fetch, request} = setup(false, true);
        const one = defer<ReturnType<typeof begun>>();
        const two = defer<ReturnType<typeof begun>>();
        const cancelled = defer<typeof released>();
        let reservations = 0;
        fetch.mockImplementation(async (call) => {
          if (call.method === "zbuilder_reserveBeginV1") return reservation(++reservations);
          if (call.method === "zbuilder_beginReservedV1")
            return Array.isArray(call.params) && call.params[0] === ticket() ? one.promise : two.promise;
          return Array.isArray(call.params) && call.params[0] === ticket() ? cancelled.promise : released;
        });
        const first = source.prepare(request, signal);
        const second = source.prepare(request, signal);
        const settled = Promise.allSettled([first, second]);
        await vi.advanceTimersByTimeAsync(0);
        const rejected = new ErrorJsonRpcResponse(
          {jsonrpc: "2.0", id: 1, error: {code: -32000, message: "SlotNotArmed"}},
          "zbuilder_beginReservedV1"
        );
        one.reject(rejected);
        two.reject(rejected);
        await settled;
        await vi.advanceTimersByTimeAsync(400);
        await expect(source.prepare(request, signal)).rejects.toMatchObject({
          type: {code: SessionPayloadErrorCode.CAPACITY},
        });
        expect(reservations).toBe(2);
        expect(source.getResources()).toMatchObject({releasing: 1, uncertain: 0});
        cancelled.resolve(released);
        await source.reconcileResources(signal);
        expect(source.getResources()).toMatchObject({releasing: 0, uncertain: 0});
      } finally {
        vi.useRealTimers();
      }
    });

    it("distinguishes late native rejection from lost replies without dropping cleanup ownership", async () => {
      const {source, fetch, request, warn} = setup(false, true);
      const begin = defer<ReturnType<typeof begun>>();
      const cancellation = defer<typeof released>();
      fetch
        .mockResolvedValueOnce(reservation())
        .mockImplementationOnce(() => begin.promise)
        .mockImplementationOnce(() => cancellation.promise);
      const controller = new AbortController();
      const preparing = source.prepare(request, controller.signal);
      const error = new ErrorJsonRpcResponse(
        {jsonrpc: "2.0", id: 1, error: {code: -32000, message: "SlotNotArmed"}},
        "zbuilder_beginReservedV1"
      );
      const rejected = expect(preparing).rejects.toBe(error);
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
      controller.abort();
      begin.reject(error);
      await rejected;
      expect(source.getResources()).toMatchObject({preparing: 0, releasing: 1, uncertain: 0});
      expect(warn).toHaveBeenCalledExactlyOnceWith("Constructor begin rejected", {
        code: "SESSION_PAYLOAD_BEGIN_REJECTED",
        reason: "SlotNotArmed",
        method: "zbuilder_beginReservedV1",
        slot: request.payloadAttributes.slotNumber,
        callerAborted: true,
        cleanupPending: true,
        sessionId: ticket(),
      });
      cancellation.resolve(released);
      await source.reconcileResources(signal);
      expect(source.getResources()).toMatchObject({preparing: 0, releasing: 0, uncertain: 0});
    });

    it("keeps rejection diagnostics sanitized and cleanup intact if the logger throws", async () => {
      const {source, fetch, request, warn} = setup(false, true);
      const response = {
        jsonrpc: "2.0" as const,
        id: 1,
        error: {code: -32000, message: "secret-auth-and-private-transaction", data: {privatePayload: "secret"}},
      };
      const error = new ErrorJsonRpcResponse(response, "zbuilder_beginReservedV1");
      warn.mockImplementation(() => {
        throw new Error("logger unavailable");
      });
      fetch.mockResolvedValueOnce(reservation()).mockRejectedValueOnce(error).mockResolvedValueOnce(released);
      await expect(source.prepare(request, signal)).rejects.toBe(error);
      await source.reconcileResources(signal);
      expect(source.getResources()).toMatchObject({preparing: 0, releasing: 0, uncertain: 0});
      expect(warn.mock.calls).toEqual([
        [
          "Constructor begin rejected",
          {
            code: "SESSION_PAYLOAD_BEGIN_REJECTED",
            reason: "OtherJsonRpcRejection",
            method: "zbuilder_beginReservedV1",
            slot: request.payloadAttributes.slotNumber,
            callerAborted: false,
            cleanupPending: true,
            sessionId: ticket(),
          },
        ],
      ]);
    });

    it("cannot lose reserved primary ownership when reading rejection diagnostics fails", async () => {
      const {source, fetch, request} = setup(false, true);
      const error = new ErrorJsonRpcResponse(
        {jsonrpc: "2.0", id: 1, error: {code: -32000, message: "SlotNotArmed"}},
        "zbuilder_beginReservedV1"
      );
      Object.defineProperty(error, "response", {
        get() {
          throw new Error("unreadable diagnostic response");
        },
      });
      const cancellation = defer<typeof released>();
      fetch
        .mockResolvedValueOnce(reservation())
        .mockRejectedValueOnce(error)
        .mockImplementationOnce(() => cancellation.promise);
      await expect(source.prepare(request, signal)).rejects.toBe(error);
      expect(source.getResources()).toMatchObject({preparing: 0, releasing: 1, uncertain: 0});
      cancellation.resolve(released);
      await source.reconcileResources(signal);
      expect(source.getResources()).toMatchObject({preparing: 0, releasing: 0, uncertain: 0});
    });

    it("retains uncertain ownership and the original cancellation error when diagnostics are unreadable", async () => {
      const {source, fetch, request} = setup(false, true);
      fetch.mockResolvedValueOnce(reservation()).mockResolvedValueOnce(begun());
      const handle = await source.prepare(request, signal);
      const error = new ErrorJsonRpcResponse(
        {jsonrpc: "2.0", id: 1, error: {code: -32000, message: "BeginReservationInstanceMismatch"}},
        "zbuilder_cancelBeginV1"
      );
      Object.defineProperty(error, "response", {
        get() {
          throw new Error("unreadable diagnostic response");
        },
      });
      fetch.mockRejectedValueOnce(error);
      await expect(source.release(handle, signal)).rejects.toBe(error);
      expect(source.getResources()).toMatchObject({active: 0, releasing: 0, uncertain: 1});
      fetch.mockResolvedValueOnce(released);
      await source.reconcileResources(signal);
      expect(source.getResources()).toMatchObject({active: 0, releasing: 0, uncertain: 0});
      expect(fetch).toHaveBeenCalledTimes(4);
    });

    it("waits for the rejected ticket's cancellation before reserving its retry", async () => {
      vi.useFakeTimers({toFake: ["setTimeout", "clearTimeout", "performance"]});
      try {
        const {source, fetch, request} = setup(false, true);
        const error = new ErrorJsonRpcResponse(
          {jsonrpc: "2.0", id: 1, error: {code: -32000, message: "SlotNotArmed"}},
          "zbuilder_beginReservedV1"
        );
        fetch
          .mockResolvedValueOnce(reservation())
          .mockRejectedValueOnce(error)
          .mockRejectedValueOnce(new Error("cancel reply lost"));
        await expect(source.prepare(request, signal)).rejects.toBe(error);
        await expect(source.reconcileResources(signal)).rejects.toThrow("cancel reply lost");
        const cancellation = defer<typeof released>();
        fetch.mockImplementationOnce(() => cancellation.promise);
        const retry = source.prepare(request, signal);
        const blocked = expect(retry).rejects.toMatchObject({type: {code: SessionPayloadErrorCode.CAPACITY}});
        await vi.advanceTimersByTimeAsync(200);
        await blocked;
        expect(fetch.mock.calls.map(([call]) => call.method)).toEqual([
          "zbuilder_reserveBeginV1",
          "zbuilder_beginReservedV1",
          "zbuilder_cancelBeginV1",
          "zbuilder_cancelBeginV1",
        ]);
        cancellation.resolve(released);
        await source.reconcileResources(signal);
        fetch.mockResolvedValueOnce(reservation(2)).mockResolvedValueOnce(begun(2));
        await source.prepare(request, signal);
        expect(source.getResources()).toMatchObject({active: 1, uncertain: 0});
      } finally {
        vi.useRealTimers();
      }
    });

    it("cleans a late successful begin after caller abort without losing its identity", async () => {
      const {source, fetch, request, signals} = setup(true, true);
      const begin = defer<ReturnType<typeof begun>>();
      fetch
        .mockResolvedValueOnce(reservation())
        .mockImplementationOnce(() => begin.promise)
        .mockResolvedValueOnce(released);
      const controller = new AbortController();
      const prepared = source.prepare(request, controller.signal);
      const rejected = expect(prepared).rejects.toBeInstanceOf(ErrorAborted);
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
      controller.abort();
      expect(signals[1].aborted).toBe(false);
      expect(source.getResources()).toMatchObject({preparing: 1});
      begin.resolve(begun());
      await rejected;
      await source.reconcileResources(signal);
      expect(source.getResources()).toMatchObject({preparing: 0, releasing: 0, uncertain: 0, active: 0});
      expect(fetch).toHaveBeenLastCalledWith({method: "zbuilder_cancelBeginV1", params: [ticket()]});
    });

    it("rejects a reused reservation without cancelling another live session", async () => {
      const {source, fetch, request} = setup(true, true);
      fetch.mockResolvedValueOnce(reservation()).mockResolvedValueOnce(begun());
      await source.prepare(request, signal);
      fetch.mockResolvedValueOnce(reservation());
      await expect(source.prepare({...request, requireUnleased: true}, signal)).rejects.toMatchObject({
        type: {code: SessionPayloadErrorCode.INVALID_SESSION},
      });
      expect(source.getResources()).toMatchObject({active: 1, uncertain: 0, preparing: 0});
      expect(fetch).toHaveBeenCalledTimes(3);
    });

    it("recovers two lost HTTP begin replies without retrying begin or restarting the source", async () => {
      let next = 0;
      let dropped = 0;
      const active = new Set<string>();
      const reserved = new Set<string>();
      const methods: string[] = [];
      const server = createServer(async (req, res) => {
        let body = "";
        for await (const chunk of req) body += chunk;
        const call = JSON.parse(body) as {id: number; method: string; params: unknown[]};
        methods.push(call.method);
        let result: unknown;
        if (call.method === "zbuilder_reserveBeginV1") {
          reserved.add(ticket(++next));
          result = reservation(next);
        } else if (call.method === "zbuilder_beginReservedV1") {
          const id = String(call.params[0]);
          expect(reserved.delete(id)).toBe(true);
          active.add(id);
          if (dropped++ < 2) {
            res.destroy();
            return;
          }
          result = {...begun(next), sessionId: id};
        } else if (call.method === "zbuilder_cancelBeginV1") {
          const id = String(call.params[0]);
          reserved.delete(id);
          active.delete(id);
          result = released;
        } else throw new Error(`Unexpected method ${call.method}`);
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({jsonrpc: "2.0", id: call.id, result}));
      });
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      try {
        const address = server.address();
        if (!address || typeof address === "string") throw new Error("Missing listener address");
        const source = new SessionPayloadSource(
          "socket",
          (signal) => new JsonRpcHttpClient([`http://127.0.0.1:${address.port}`], {signal, timeout: 1000}),
          {beginReservations: true}
        );
        for (let i = 0; i < 2; i++) {
          await expect(source.prepare(buildRequest(), signal)).rejects.toBeInstanceOf(FetchError);
          await source.reconcileResources(signal);
          expect(source.getResources()).toMatchObject({
            preparing: 0,
            active: 0,
            uncertain: 0,
            releasing: 0,
            alternatesDisabled: false,
          });
          expect(active.size).toBe(0);
        }
        const handle = await source.prepare(buildRequest(), signal);
        expect(active).toEqual(new Set([handle.payloadId]));
        await source.release(handle, signal);
        expect(methods.filter((method) => method === "zbuilder_beginReservedV1")).toHaveLength(3);
        expect(methods.every((method) => method !== "zbuilder_beginV1" && method !== "zbuilder_endV1")).toBe(true);
        expect(active.size).toBe(0);
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
      }
    });
  });

  describe("native begin rejection pacing", () => {
    const rejected = (message = "SlotNotArmed") =>
      new ErrorJsonRpcResponse({jsonrpc: "2.0", id: 1, error: {code: -32000, message}}, "zbuilder_beginV1");

    it.each([
      {reason: "SlotNotArmed", bounded: false},
      {reason: "SlotNotArmed", bounded: true},
      {reason: "ConstructionHalted", bounded: true},
    ])("backs off $reason within a fixed bound (tracked=$bounded)", async ({reason, bounded}) => {
      vi.useFakeTimers({toFake: ["setTimeout", "clearTimeout", "performance"]});
      try {
        const {source, fetch, request} = setup(bounded);
        const error = rejected(reason);
        fetch.mockRejectedValue(error);
        await expect(source.prepare(request, signal)).rejects.toBe(error);
        for (const [i, delay] of [200, 400, 800, 1000, 1000].entries()) {
          const retry = expect(source.prepare(request, signal)).rejects.toBe(error);
          await vi.advanceTimersByTimeAsync(delay - 1);
          expect(fetch).toHaveBeenCalledTimes(i + 1);
          await vi.advanceTimersByTimeAsync(1);
          await retry;
          expect(fetch).toHaveBeenCalledTimes(i + 2);
        }
        if (bounded) expect(source.getResources()).toMatchObject({preparing: 0, uncertain: 0, active: 0});
        else expect(source.getResources()).toBeUndefined();
      } finally {
        vi.useRealTimers();
      }
    });

    it("cancels a backoff without sending or reserving another begin", async () => {
      const {source, fetch, request} = setup(true);
      fetch.mockRejectedValueOnce(rejected());
      await expect(source.prepare(request, signal)).rejects.toBeInstanceOf(ErrorJsonRpcResponse);
      const controller = new AbortController();
      const preparing = source.prepare(request, controller.signal);
      const stopped = expect(preparing).rejects.toBeInstanceOf(ErrorAborted);
      controller.abort();
      await stopped;
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(source.getResources()).toMatchObject({preparing: 0, uncertain: 0});
    });

    it("keeps the original orchestrator deadline while waiting for a backoff", async () => {
      const {source, fetch, request} = setup(true);
      fetch.mockRejectedValue(rejected());
      await expect(source.prepare(request, signal)).rejects.toBeInstanceOf(ErrorJsonRpcResponse);
      const orchestrator = new PayloadOrchestrator(source, {getPayloadTimeout: 1000}, signal);
      await expect(
        orchestrator.run({id: "arming-deadline", request, getPayloadAt: Date.now() + 30})
      ).rejects.toMatchObject({
        type: {code: PayloadOrchestratorErrorCode.PREPARE_TIMEOUT},
      });
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(source.getResources()).toMatchObject({preparing: 0, uncertain: 0});
    });

    it("admits a new slot immediately and ignores a late older slot rejection for its backoff", async () => {
      vi.useFakeTimers({toFake: ["setTimeout", "clearTimeout", "performance"]});
      try {
        const {source, fetch, request} = setup(true);
        const old = defer<{sessionId: string}>();
        fetch.mockImplementationOnce(() => old.promise);
        const previous = expect(source.prepare(request, signal)).rejects.toBeInstanceOf(ErrorJsonRpcResponse);
        const next = {...request, payloadAttributes: {...request.payloadAttributes, slotNumber: 13}};
        fetch.mockResolvedValueOnce({sessionId: "next-slot"});
        const nextPrepared = source.prepare(next, signal);
        expect(fetch).toHaveBeenCalledTimes(2);
        const handle = await nextPrepared;
        old.reject(rejected());
        await previous;
        fetch.mockResolvedValueOnce(true);
        await source.release(handle, signal);
        fetch.mockResolvedValueOnce({sessionId: "next-slot-retry"});
        const retry = source.prepare(next, signal);
        expect(fetch).toHaveBeenCalledTimes(4);
        await retry;
        expect(performance.now()).toBe(0);
        expect(source.getResources()).toMatchObject({preparing: 0, uncertain: 0, active: 1});
      } finally {
        vi.useRealTimers();
      }
    });

    it("resets the backoff after successful preparation", async () => {
      vi.useFakeTimers({toFake: ["setTimeout", "clearTimeout", "performance"]});
      try {
        const {source, fetch, request} = setup(true);
        fetch.mockRejectedValueOnce(rejected());
        await expect(source.prepare(request, signal)).rejects.toBeInstanceOf(ErrorJsonRpcResponse);
        fetch.mockResolvedValueOnce({sessionId: "ready"});
        const retry = source.prepare(request, signal);
        await vi.advanceTimersByTimeAsync(200);
        const handle = await retry;
        fetch.mockResolvedValueOnce(true);
        await source.release(handle, signal);
        fetch.mockRejectedValueOnce(rejected());
        await expect(source.prepare(request, signal)).rejects.toBeInstanceOf(ErrorJsonRpcResponse);
        fetch.mockResolvedValueOnce({sessionId: "ready-again"});
        const next = source.prepare(request, signal);
        await vi.advanceTimersByTimeAsync(199);
        expect(fetch).toHaveBeenCalledTimes(4);
        await vi.advanceTimersByTimeAsync(1);
        expect(fetch).toHaveBeenCalledTimes(5);
        await next;
        expect(source.getResources()).toMatchObject({active: 1, uncertain: 0});
      } finally {
        vi.useRealTimers();
      }
    });

    it("rate limits each sanitized rejection reason without creating an alternate retry loop", async () => {
      const {source, fetch, request, warn} = setup(true);
      const clock = vi.spyOn(performance, "now").mockReturnValue(1000);
      try {
        fetch.mockResolvedValueOnce({sessionId: "primary"});
        await source.prepare(request, signal);
        fetch.mockRejectedValue(rejected());
        for (let i = 0; i < 32; i++)
          await expect(source.prepare({...request, requireUnleased: true}, signal)).rejects.toBeInstanceOf(
            ErrorJsonRpcResponse
          );
        expect(fetch).toHaveBeenCalledTimes(33);
        expect(warn).toHaveBeenCalledTimes(1);
        fetch.mockRejectedValueOnce(rejected("SessionLimit"));
        await expect(source.prepare({...request, requireUnleased: true}, signal)).rejects.toBeInstanceOf(
          ErrorJsonRpcResponse
        );
        expect(warn).toHaveBeenCalledTimes(2);
        clock.mockReturnValue(2000);
        await expect(source.prepare({...request, requireUnleased: true}, signal)).rejects.toBeInstanceOf(
          ErrorJsonRpcResponse
        );
        expect(warn).toHaveBeenCalledTimes(3);
        expect(source.getResources()).toMatchObject({active: 1, preparing: 0, uncertain: 0, alternatesDisabled: false});
        fetch.mockResolvedValueOnce({sessionId: "next-primary"});
        const primary = source.prepare(request, signal);
        expect(fetch).toHaveBeenCalledTimes(36);
        await primary;
      } finally {
        clock.mockRestore();
      }
    });
  });

  it("changes generations even when value drops and the block hash repeats", async () => {
    const {source, fetch, request} = setup();
    const now = vi.spyOn(performance, "now").mockReturnValue(100);
    try {
      fetch.mockResolvedValueOnce({sessionId: "leased", orderGenerationVersion: 1});
      const handle = await source.prepare(request, signal);
      const output = payloadResponse(request);
      fetch.mockResolvedValueOnce({generation: "0x0", ready: true, leaseMs: 250, payload: output});
      const old = await source.getPayload(handle, signal);
      expect(old.offerEligibility?.lease.validUntil).toBe(350);
      fetch.mockResolvedValueOnce({generation: "0x1", ready: false, leaseMs: 250, payload: null});
      await expect(source.getPayload(handle, signal)).rejects.toBeInstanceOf(PayloadSourceNotReady);
      expect(old.offerEligibility?.lease.ready).toBe(false);
      fetch.mockResolvedValueOnce({
        generation: "0x1",
        ready: true,
        leaseMs: 250,
        payload: {...output, blockValue: "0x1"},
      });
      const next = await source.getPayload(handle, signal);
      expect(next.executionPayloadValue).toBe(1n);
      expect(next.offerEligibility?.generation).toBe("0x1");
      expect(old.offerEligibility?.generation).toBe("0x0");
      fetch.mockResolvedValueOnce({generation: "0x1", ready: true, leaseMs: 250, payload: null});
      expect(await source.getPayload(handle, signal)).toBe(next);
      fetch.mockResolvedValueOnce({generation: "0x0", ready: true, leaseMs: 250, payload: output});
      await expect(source.getPayload(handle, signal)).rejects.toMatchObject({
        type: {code: SessionPayloadErrorCode.RESPONSE_MISMATCH, reason: "Order generation rollback"},
      });
      expect(next.offerEligibility?.lease.ready).toBe(false);
    } finally {
      now.mockRestore();
    }
  });

  it("charges delayed RPC delivery against the lease and never renews from response arrival", async () => {
    const {source, fetch, request} = setup();
    const now = vi.spyOn(performance, "now").mockReturnValue(100);
    try {
      fetch.mockResolvedValueOnce({sessionId: "delayed", orderGenerationVersion: 1});
      const handle = await source.prepare(request, signal);
      fetch.mockImplementationOnce(async () => {
        now.mockReturnValue(351);
        return {generation: "0x0", ready: true, leaseMs: 250, payload: payloadResponse(request)};
      });
      await expect(source.getPayload(handle, signal)).rejects.toBeInstanceOf(PayloadSourceNotReady);
      fetch.mockResolvedValueOnce({generation: "0x0", ready: true, leaseMs: 250, payload: null});
      const renewed = await source.getPayload(handle, signal);
      expect(renewed.offerEligibility?.lease.validUntil).toBe(601);
      expect(fetch).toHaveBeenLastCalledWith({
        method: "zbuilder_getPayloadV2",
        params: [handle.payloadId, payloadResponse(request).executionPayload.blockHash, "0x0"],
      });
      fetch.mockResolvedValueOnce(true);
      await source.release(handle, signal);
      expect(renewed.offerEligibility?.lease.ready).toBe(false);
    } finally {
      now.mockRestore();
    }
  });

  function transportError(code: string): FetchError {
    return new FetchError(
      "http://constructor",
      new TypeError("fetch failed", {cause: Object.assign(new Error("closed"), {code})})
    );
  }

  it.each(["UND_ERR_SOCKET", "ECONNRESET"])(
    "retries one tracked endV1 %s failure before releasing capacity",
    async (code) => {
      vi.useFakeTimers({toFake: ["setTimeout", "clearTimeout", "performance"]});
      try {
        const {source, fetch, request, signals} = setup(true);
        fetch.mockResolvedValueOnce({sessionId: "tracked"});
        const handle = await source.prepare(request, signal);
        fetch.mockRejectedValueOnce(transportError(code)).mockResolvedValueOnce(true);
        const release = source.release(handle, signal);
        await vi.advanceTimersByTimeAsync(99);
        expect(source.getResources()).toMatchObject({active: 0, releasing: 1, uncertain: 0});
        expect(fetch).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(1);
        await release;
        expect(fetch).toHaveBeenCalledTimes(3);
        expect(fetch.mock.calls.slice(1).map(([call]) => call)).toEqual([
          {method: "zbuilder_endV1", params: [handle.payloadId]},
          {method: "zbuilder_endV1", params: [handle.payloadId]},
        ]);
        expect(signals.at(-1)).toBe(signals.at(-2));
        expect(signals.at(-1)).toBe(signal);
        expect(source.getResources()).toMatchObject({active: 0, releasing: 0, uncertain: 0});
      } finally {
        vi.useRealTimers();
      }
    }
  );

  it("does not add transport retries to an untracked legacy release", async () => {
    const {source, fetch, request} = setup();
    fetch.mockResolvedValueOnce({sessionId: "untracked"});
    const handle = await source.prepare(request, signal);
    fetch.mockRejectedValueOnce(transportError("UND_ERR_SOCKET"));
    await expect(source.release(handle, signal)).rejects.toBeInstanceOf(FetchError);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(source.getResources()).toBeUndefined();
  });

  it("cannot revive an offer with a read response arriving after release", async () => {
    const {source, fetch, request} = setup();
    fetch.mockResolvedValueOnce({sessionId: "released", orderGenerationVersion: 1});
    const handle = await source.prepare(request, signal);
    const response = {generation: "0x0", ready: true, leaseMs: 250, payload: payloadResponse(request)};
    fetch.mockResolvedValueOnce(response);
    const first = await source.getPayload(handle, signal);
    let finish!: (value: typeof response) => void;
    fetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const late = source.getPayload(handle, signal);
    fetch.mockResolvedValueOnce(true);
    await source.release(handle, signal);
    finish(response);
    await expect(late).rejects.toMatchObject({type: {code: SessionPayloadErrorCode.UNKNOWN_HANDLE}});
    expect(first.offerEligibility?.lease.ready).toBe(false);
  });

  it("recovers a payload through the real HTTP client after the peer closes the socket", async () => {
    const request = buildRequest();
    const output = payloadResponse(request);
    const methods: string[] = [];
    let closeRead = true;
    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const call = JSON.parse(Buffer.concat(chunks).toString()) as {id: number; method: string};
      methods.push(call.method);
      if (call.method === "zbuilder_getPayloadV1" && closeRead) {
        closeRead = false;
        req.socket.destroy();
        return;
      }
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: call.id,
          result: call.method === "zbuilder_beginV1" ? {sessionId: "socket"} : output,
        })
      );
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Missing listener address");
      const source = new SessionPayloadSource(
        "socket",
        (signal) => new JsonRpcHttpClient([`http://127.0.0.1:${address.port}`], {signal, timeout: 1000})
      );
      const handle = await source.prepare(request, signal);
      expect((await source.getPayload(handle, signal)).executionPayloadValue).toBe(BigInt(output.blockValue));
      expect(methods).toEqual(["zbuilder_beginV1", "zbuilder_getPayloadV1", "zbuilder_getPayloadV1"]);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });

  it.each(["UND_ERR_SOCKET", "ECONNRESET"])("retries one %s read with the original signal", async (code) => {
    const {source, fetch, signals, request} = setup();
    const output = payloadResponse(request);
    fetch
      .mockResolvedValueOnce({sessionId: "retry"})
      .mockRejectedValueOnce(transportError(code))
      .mockResolvedValueOnce(output);
    const handle = await source.prepare(request, signal);
    expect((await source.getPayload(handle, signal)).executionPayloadValue).toBe(BigInt(output.blockValue));
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls[2]).toEqual(fetch.mock.calls[1]);
    expect(signals.every((value) => value === signal)).toBe(true);
  });

  it("does not retry a second connection failure", async () => {
    const {source, fetch, request} = setup();
    const error = transportError("UND_ERR_SOCKET");
    fetch.mockResolvedValueOnce({sessionId: "retry"}).mockRejectedValue(error);
    const handle = await source.prepare(request, signal);
    await expect(source.getPayload(handle, signal)).rejects.toBe(error);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("does not restart a read after slot cancellation", async () => {
    const {source, fetch, request} = setup();
    const controller = new AbortController();
    fetch.mockResolvedValueOnce({sessionId: "retry"}).mockImplementationOnce(async () => {
      controller.abort();
      throw transportError("UND_ERR_SOCKET");
    });
    const handle = await source.prepare(request, controller.signal);
    await expect(source.getPayload(handle, controller.signal)).rejects.toBeInstanceOf(ErrorAborted);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([new Error("invalid JSON"), transportError("ECONNREFUSED"), transportError("ERR_TIMEOUT")])(
    "does not retry other failures: %s",
    async (error) => {
      const {source, fetch, request} = setup();
      fetch.mockResolvedValueOnce({sessionId: "retry"}).mockRejectedValueOnce(error);
      const handle = await source.prepare(request, signal);
      await expect(source.getPayload(handle, signal)).rejects.toBe(error);
      expect(fetch).toHaveBeenCalledTimes(2);
    }
  );

  it("does not retry session creation on a closing socket", async () => {
    const {source, fetch, request} = setup();
    const error = transportError("UND_ERR_SOCKET");
    fetch.mockRejectedValueOnce(error);
    await expect(source.prepare(request, signal)).rejects.toBe(error);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("retrieves multiple snapshots from one handle and releases without invalidating them", async () => {
    const {source, fetch, signals, request} = setup();
    const first = payloadResponse(request, []);
    const second = payloadResponse(request);
    second.executionPayload.blockHash = "0x" + "55".repeat(32);
    fetch
      .mockResolvedValueOnce({sessionId: "session-1"})
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second)
      .mockResolvedValueOnce(true);
    const handle = await source.prepare(request, signal);
    const a = await source.getPayload(handle, signal);
    const b = await source.getPayload(handle, signal);
    await source.release(handle, signal);
    expect(fetch.mock.calls.map(([call]) => call.method)).toEqual([
      "zbuilder_beginV1",
      "zbuilder_getPayloadV1",
      "zbuilder_getPayloadV1",
      "zbuilder_endV1",
    ]);
    expect(fetch.mock.calls[0][0].params).toEqual([
      request.forkchoiceState.headBlockHash,
      serializePayloadAttributes(request.payloadAttributes),
    ]);
    expect(signals.every((value) => value === signal)).toBe(true);
    expect(a.executionPayload.transactions).toHaveLength(0);
    expect(b.executionPayload.transactions).toHaveLength(2);
    await expect(source.getPayload(handle, signal)).rejects.toMatchObject({
      type: {code: SessionPayloadErrorCode.UNKNOWN_HANDLE},
    });
  });

  it.each(["parentHash", "timestamp", "slotNumber", "prevRandao", "feeRecipient", "withdrawals"] as const)(
    "rejects a snapshot with changed %s",
    async (field) => {
      const {source, fetch, request} = setup();
      const output = payloadResponse(request);
      if (field === "withdrawals") output.executionPayload.withdrawals = [];
      else if (field === "parentHash" || field === "prevRandao")
        output.executionPayload[field] = "0x" + "ff".repeat(32);
      else if (field === "feeRecipient") output.executionPayload[field] = "0x" + "ff".repeat(20);
      else output.executionPayload[field] = "0x01";
      fetch.mockResolvedValueOnce({sessionId: "session-1"}).mockResolvedValueOnce(output);
      const handle = await source.prepare(request, signal);
      await expect(source.getPayload(handle, signal)).rejects.toMatchObject({
        type: {code: SessionPayloadErrorCode.RESPONSE_MISMATCH},
      });
    }
  );

  it("preserves constructor extra data and rejects more than 32 bytes", async () => {
    const {source, fetch, request} = setup();
    const output = payloadResponse(request);
    output.executionPayload.extraData = "0x" + Buffer.from("zbuilder 0123456789ab").toString("hex");
    fetch.mockResolvedValueOnce({sessionId: "session-1"}).mockResolvedValueOnce(output);
    const handle = await source.prepare(request, signal);
    const payload = await source.getPayload(handle, signal);
    expect(Buffer.from(payload.executionPayload.extraData).toString()).toBe("zbuilder 0123456789ab");
    output.executionPayload.extraData = "0x" + "aa".repeat(33);
    fetch.mockResolvedValueOnce(output);
    await expect(source.getPayload(handle, signal)).rejects.toThrow();
  });

  it("releases a begin response arriving after cancellation", async () => {
    const {source, fetch, request} = setup();
    const controller = new AbortController();
    fetch
      .mockImplementationOnce(async () => {
        controller.abort();
        return {sessionId: "late"};
      })
      .mockResolvedValueOnce(true);
    await expect(source.prepare(request, controller.signal)).rejects.toBeInstanceOf(ErrorAborted);
    expect(fetch.mock.calls[1][0]).toEqual({method: "zbuilder_endV1", params: ["late"]});
  });

  function withBlobs(
    request: BuildRequest,
    count = 1
  ): PayloadResponse & {blobsBundle: NonNullable<PayloadResponse["blobsBundle"]>} {
    const output = payloadResponse(request, []);
    const commitment = Buffer.alloc(48, 7);
    const hash = createHash("sha256").update(commitment).digest();
    hash[0] = 1;
    const fields = Array.from({length: 14}, () => new Uint8Array());
    const tx = [...fields.slice(0, 10), Array.from({length: count}, () => hash), ...fields.slice(11)];
    output.executionPayload.transactions = [toHex(Buffer.concat([Buffer.from([3]), RLP.encode(tx)]))];
    output.executionPayload.blobGasUsed = "0x" + (count * 131072).toString(16);
    output.blobsBundle = {
      blobs: Array.from({length: count}, () => "0x" + "00".repeat(131072)),
      commitments: Array.from({length: count}, () => toHex(commitment)),
      proofs: Array.from({length: count * 128}, () => "0x" + "11".repeat(48)),
    };
    return {...output, blobsBundle: output.blobsBundle};
  }

  it("retains ordered blob data, including repeated hashes, after release", async () => {
    const {source, fetch, request} = setup();
    fetch.mockResolvedValueOnce({sessionId: "blobs"}).mockResolvedValueOnce(withBlobs(request, 2));
    const handle = await source.prepare(request, signal);
    const payload = await source.getPayload(handle, signal);
    fetch.mockResolvedValueOnce(true);
    await source.release(handle, signal);
    expect(payload.blobsBundle.blobs).toHaveLength(2);
    expect(payload.blobsBundle.proofs).toHaveLength(256);
    expect(payload.executionPayload.blobGasUsed).toBe(262144n);
  });

  it.each(["missingBlob", "oldProofs", "wrongCommitment", "wrongGas", "wrappedTransaction"])(
    "rejects incomplete blob reveals: %s",
    async (fault) => {
      const {source, fetch, request} = setup();
      const response = withBlobs(request);
      if (fault === "missingBlob") response.blobsBundle.blobs = [];
      if (fault === "oldProofs") response.blobsBundle.proofs = response.blobsBundle.proofs.slice(0, 1);
      if (fault === "wrongCommitment") response.blobsBundle.commitments[0] = "0x" + "08".repeat(48);
      if (fault === "wrongGas") response.executionPayload.blobGasUsed = "0x0";
      if (fault === "wrappedTransaction") response.executionPayload.transactions[0] = "0x03c0";
      fetch.mockResolvedValueOnce({sessionId: "blobs"}).mockResolvedValueOnce(response);
      const handle = await source.prepare(request, signal);
      await expect(source.getPayload(handle, signal)).rejects.toMatchObject({
        type: {code: SessionPayloadErrorCode.RESPONSE_MISMATCH},
      });
    }
  );

  describe("bounded alternate reservations", () => {
    const errorCode = (code: SessionPayloadErrorCode) => ({type: {code}});
    const rejectedBegin = (message: string, code = -32000) =>
      new ErrorJsonRpcResponse({jsonrpc: "2.0", id: 1, error: {code, message}}, "zbuilder_beginAlternateV1");

    it("leaves ordinary sources unchanged and refuses alternate work before RPC", async () => {
      const {source, fetch, request} = setup();
      expect(source.supportsBoundedAlternates).toBe(false);
      expect(source.getResources()).toBeUndefined();
      await expect(source.prepare({...request, requireUnleased: true}, signal)).rejects.toMatchObject(
        errorCode(SessionPayloadErrorCode.ALTERNATE_UNSUPPORTED)
      );
      expect(fetch).not.toHaveBeenCalled();
    });

    it("requires an active primary and reserves each pending begin before RPC completes", async () => {
      const {source, fetch, request} = setup(true);
      await expect(source.prepare({...request, requireUnleased: true}, signal)).rejects.toMatchObject(
        errorCode(SessionPayloadErrorCode.CAPACITY)
      );
      const begin = defer<{sessionId: string}>();
      fetch.mockImplementationOnce(() => begin.promise);
      const preparing = source.prepare(request, signal);
      expect(source.getResources()).toEqual({
        capacity: 2,
        preparing: 1,
        active: 0,
        releasing: 0,
        uncertain: 0,
        alternatesDisabled: false,
      });
      await expect(source.prepare({...request, requireUnleased: true}, signal)).rejects.toMatchObject(
        errorCode(SessionPayloadErrorCode.CAPACITY)
      );
      begin.resolve({sessionId: "primary"});
      await preparing;
      const alternate = defer<{sessionId: string; orderGenerationVersion: number; alternateSessionVersion: number}>();
      fetch.mockImplementationOnce(() => alternate.promise);
      const preparingAlternate = source.prepare({...request, requireUnleased: true}, signal);
      expect(source.getResources()).toMatchObject({preparing: 1, active: 1, uncertain: 0});
      expect(fetch).toHaveBeenLastCalledWith(
        {
          method: "zbuilder_beginAlternateV1",
          params: [request.forkchoiceState.headBlockHash, serializePayloadAttributes(request.payloadAttributes)],
        },
        {timeout: 20_000}
      );
      await expect(source.prepare(request, signal)).rejects.toMatchObject(errorCode(SessionPayloadErrorCode.CAPACITY));
      alternate.resolve({sessionId: "alternate", orderGenerationVersion: 0, alternateSessionVersion: 1});
      await preparingAlternate;
      expect(source.getResources()).toMatchObject({preparing: 0, active: 2, uncertain: 0});
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it("does not reserve a worker if request serialization fails before RPC", async () => {
      const {source, fetch, request} = setup(true);
      Object.defineProperty(request.payloadAttributes, "prevRandao", {
        get() {
          throw new Error("attribute serialization failed");
        },
      });
      await expect(source.prepare(request, signal)).rejects.toThrow("attribute serialization failed");
      expect(fetch).not.toHaveBeenCalled();
      expect(source.getResources()).toMatchObject({preparing: 0, active: 0, releasing: 0, uncertain: 0});
    });

    it("does not reserve a worker when creating the RPC client fails before fetch", async () => {
      const rpc = new JsonRpcHttpClient(["http://127.0.0.1:1"]);
      const fetch = vi.spyOn(rpc, "fetch").mockResolvedValueOnce({sessionId: "recovered"});
      const factory = vi.fn(() => rpc);
      const source = new SessionPayloadSource("session", factory, {boundedAlternates: true});
      for (let i = 0; i < 2; i++) {
        factory.mockImplementationOnce(() => {
          throw new Error("client unavailable before fetch");
        });
        await expect(source.prepare(buildRequest(), signal)).rejects.toThrow("client unavailable before fetch");
        expect(source.getResources()).toMatchObject({preparing: 0, active: 0, uncertain: 0, alternatesDisabled: false});
        expect(fetch).not.toHaveBeenCalled();
      }
      await expect(source.prepare(buildRequest(), signal)).resolves.toMatchObject({payloadId: "recovered"});
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it("reconciles cleanup failures that appear between primary allocation attempts", async () => {
      const {source, fetch, request} = setup(true);
      fetch
        .mockResolvedValueOnce({sessionId: "old-primary"})
        .mockResolvedValueOnce({sessionId: "alternate", orderGenerationVersion: 0, alternateSessionVersion: 1});
      await source.prepare(request, signal);
      const alternate = await source.prepare({...request, requireUnleased: true}, signal);
      const end = defer<boolean>();
      fetch.mockImplementationOnce(() => end.promise);
      const release = source.release(alternate, signal);
      const failed = expect(release).rejects.toThrow("lost end response");
      await expect(source.prepare(request, signal)).rejects.toMatchObject(errorCode(SessionPayloadErrorCode.CAPACITY));
      end.reject(new Error("lost end response"));
      await failed;
      fetch.mockResolvedValueOnce(true).mockResolvedValueOnce({sessionId: "new-primary"});
      await expect(source.prepare(request, signal)).rejects.toMatchObject(errorCode(SessionPayloadErrorCode.CAPACITY));
      await source.reconcileResources(signal);
      await expect(source.prepare(request, signal)).resolves.toMatchObject({payloadId: "new-primary"});
      expect(fetch.mock.calls.slice(-2).map(([call]) => call.method)).toEqual(["zbuilder_endV1", "zbuilder_beginV1"]);
      expect(source.getResources()).toMatchObject({preparing: 0, active: 2, releasing: 0, uncertain: 0});
    });

    it("uses the free worker for a primary without waiting on an uncertain old handle", async () => {
      const {source, fetch, request} = setup(true);
      fetch.mockResolvedValueOnce({sessionId: "old-primary"});
      const old = await source.prepare(request, signal);
      fetch.mockResolvedValueOnce(false);
      await expect(source.release(old, signal)).rejects.toMatchObject(
        errorCode(SessionPayloadErrorCode.RELEASE_UNCONFIRMED)
      );
      expect(source.getResources()).toMatchObject({active: 0, uncertain: 1});
      const end = defer<boolean>();
      fetch.mockImplementation(async (call) =>
        call.method === "zbuilder_endV1" ? end.promise : {sessionId: "new-primary"}
      );
      await expect(source.prepare(request, signal)).resolves.toMatchObject({payloadId: "new-primary"});
      expect(fetch.mock.calls.map(([call]) => call.method)).toEqual([
        "zbuilder_beginV1",
        "zbuilder_endV1",
        "zbuilder_beginV1",
        "zbuilder_endV1",
      ]);
      expect(source.getResources()).toMatchObject({active: 1, uncertain: 0, preparing: 0, releasing: 1});
      await expect(source.prepare({...request, requireUnleased: true}, signal)).rejects.toMatchObject(
        errorCode(SessionPayloadErrorCode.CAPACITY)
      );
      expect(fetch).toHaveBeenCalledTimes(4);
      end.resolve(true);
      await source.reconcileResources(signal);
      expect(source.getResources()).toMatchObject({active: 1, uncertain: 0, releasing: 0});
    });

    it("coalesces reconciliation while cleaning both known handles concurrently", async () => {
      const {source, fetch, request} = setup(true);
      fetch.mockResolvedValueOnce({sessionId: "first"}).mockResolvedValueOnce({sessionId: "second"});
      const first = await source.prepare(request, signal);
      const second = await source.prepare(request, signal);
      fetch.mockResolvedValueOnce(false).mockResolvedValueOnce(false);
      await expect(source.release(first, signal)).rejects.toMatchObject(
        errorCode(SessionPayloadErrorCode.RELEASE_UNCONFIRMED)
      );
      await expect(source.release(second, signal)).rejects.toMatchObject(
        errorCode(SessionPayloadErrorCode.RELEASE_UNCONFIRMED)
      );
      const firstStarted = defer<void>();
      const firstEnded = defer<void>();
      const secondStarted = defer<void>();
      const secondEnded = defer<void>();
      const order: string[] = [];
      fetch
        .mockImplementationOnce(async () => {
          order.push("first");
          firstStarted.resolve();
          await firstEnded.promise;
          return true;
        })
        .mockImplementationOnce(async () => {
          order.push("second");
          secondStarted.resolve();
          await secondEnded.promise;
          return true;
        })
        .mockResolvedValueOnce({sessionId: "new-primary"});
      await expect(source.prepare(request, signal)).rejects.toMatchObject(errorCode(SessionPayloadErrorCode.CAPACITY));
      await firstStarted.promise;
      await secondStarted.promise;
      const duplicate = source.reconcileResources(signal);
      expect(order).toEqual(["first", "second"]);
      expect(source.getResources()).toMatchObject({preparing: 0, releasing: 2, uncertain: 0});
      firstEnded.resolve();
      await vi.waitFor(() => expect(source.getResources()).toMatchObject({releasing: 1}));
      expect(order).toEqual(["first", "second"]);
      expect(source.getResources()).toMatchObject({preparing: 0, releasing: 1, uncertain: 0});
      // The first acknowledgement frees one worker even while the second
      // cleanup is still in progress. Each handle has only one cleanup RPC.
      await expect(source.prepare(request, signal)).resolves.toMatchObject({payloadId: "new-primary"});
      expect(source.getResources()).toMatchObject({active: 1, releasing: 1, uncertain: 0});
      secondEnded.resolve();
      await duplicate;
      expect(source.getResources()).toMatchObject({preparing: 0, active: 1, releasing: 0, uncertain: 0});
    });

    it("aborts a reconciliation waiter without cancelling another caller's end or beginning an orphan", async () => {
      const {source, fetch, request} = setup(true);
      fetch.mockResolvedValueOnce({sessionId: "old"}).mockResolvedValueOnce({sessionId: "second"});
      const handle = await source.prepare(request, signal);
      const second = await source.prepare(request, signal);
      fetch.mockResolvedValueOnce(false).mockResolvedValueOnce(false);
      await expect(source.release(handle, signal)).rejects.toMatchObject(
        errorCode(SessionPayloadErrorCode.RELEASE_UNCONFIRMED)
      );
      await expect(source.release(second, signal)).rejects.toMatchObject(
        errorCode(SessionPayloadErrorCode.RELEASE_UNCONFIRMED)
      );
      const started = defer<void>();
      const ended = defer<void>();
      fetch
        .mockImplementationOnce(async () => {
          started.resolve();
          await ended.promise;
          return true;
        })
        .mockResolvedValueOnce(true);
      const reconciliation = source.reconcileResources(signal);
      await started.promise;
      const controller = new AbortController();
      const waiting = source.reconcileResources(controller.signal);
      const aborted = expect(waiting).rejects.toBeInstanceOf(ErrorAborted);
      controller.abort();
      await aborted;
      expect(source.getResources()).toMatchObject({preparing: 0, releasing: 1, uncertain: 0});
      ended.resolve();
      await reconciliation;
      expect(fetch.mock.calls.map(([call]) => call.method)).toEqual([
        "zbuilder_beginV1",
        "zbuilder_beginV1",
        "zbuilder_endV1",
        "zbuilder_endV1",
        "zbuilder_endV1",
        "zbuilder_endV1",
      ]);
      expect(source.getResources()).toMatchObject({
        preparing: 0,
        active: 0,
        releasing: 0,
        uncertain: 0,
        alternatesDisabled: false,
      });
    });

    it("coalesces a late end acknowledgement without clearing its failed sibling", async () => {
      const {source, fetch, request} = setup(true);
      fetch.mockResolvedValueOnce({sessionId: "first"}).mockResolvedValueOnce({sessionId: "second"});
      const first = await source.prepare(request, signal);
      const second = await source.prepare(request, signal);
      fetch.mockResolvedValueOnce(false).mockResolvedValueOnce(false);
      await expect(source.release(first, signal)).rejects.toMatchObject(
        errorCode(SessionPayloadErrorCode.RELEASE_UNCONFIRMED)
      );
      await expect(source.release(second, signal)).rejects.toMatchObject(
        errorCode(SessionPayloadErrorCode.RELEASE_UNCONFIRMED)
      );
      const started = defer<void>();
      const acknowledged = defer<void>();
      fetch
        .mockImplementationOnce(async () => {
          started.resolve();
          await acknowledged.promise;
          return true;
        })
        .mockResolvedValueOnce(false);
      const controller = new AbortController();
      const cleanup = source.reconcileResources(controller.signal);
      const aborted = expect(cleanup).rejects.toBeInstanceOf(ErrorAborted);
      await started.promise;
      controller.abort();
      await aborted;
      const joining = source.reconcileResources(signal);
      const joiningFailed = expect(joining).rejects.toThrow();
      expect(fetch).toHaveBeenCalledTimes(6);
      expect(source.getResources()).toMatchObject({active: 0, releasing: 1, uncertain: 1});
      acknowledged.resolve();
      await joiningFailed;
      expect(fetch).toHaveBeenCalledTimes(6);
      expect(source.getResources()).toMatchObject({active: 0, releasing: 0, uncertain: 1});
      fetch.mockResolvedValueOnce(true);
      await source.reconcileResources(signal);
      expect(source.getResources()).toMatchObject({active: 0, releasing: 0, uncertain: 0});
    });

    it("keeps releasing and failed cleanup occupied until an exact acknowledgement", async () => {
      const {source, fetch, request} = setup(true);
      fetch
        .mockResolvedValueOnce({sessionId: "primary"})
        .mockResolvedValueOnce({sessionId: "alternate", orderGenerationVersion: 0, alternateSessionVersion: 1});
      await source.prepare(request, signal);
      const alternate = await source.prepare({...request, requireUnleased: true}, signal);
      const end = defer<boolean>();
      fetch.mockImplementationOnce(() => end.promise);
      const released = source.release(alternate, signal);
      const duplicate = source.release(alternate, signal);
      const rejected = expect(released).rejects.toThrow("lost reply");
      const rejectedDuplicate = expect(duplicate).rejects.toThrow("lost reply");
      expect(source.getResources()).toMatchObject({active: 1, releasing: 1, uncertain: 0});
      await expect(source.prepare(request, signal)).rejects.toMatchObject(errorCode(SessionPayloadErrorCode.CAPACITY));
      end.reject(new Error("lost reply"));
      await Promise.all([rejected, rejectedDuplicate]);
      expect(fetch).toHaveBeenCalledTimes(3);
      expect(source.getResources()).toMatchObject({active: 1, releasing: 0, uncertain: 1});
      fetch.mockResolvedValueOnce(true);
      await source.reconcileResources(signal);
      expect(source.getResources()).toMatchObject({active: 1, releasing: 0, uncertain: 0});
      fetch.mockResolvedValueOnce({sessionId: "new-primary"});
      await expect(source.prepare(request, signal)).resolves.toMatchObject({payloadId: "new-primary"});
    });

    it.each([false, null, {}, "true"])("does not treat end=%j as proof of release", async (reply) => {
      const {source, fetch, request} = setup(true);
      fetch.mockResolvedValueOnce({sessionId: "primary"});
      const handle = await source.prepare(request, signal);
      fetch.mockResolvedValueOnce(reply);
      await expect(source.release(handle, signal)).rejects.toMatchObject(
        errorCode(SessionPayloadErrorCode.RELEASE_UNCONFIRMED)
      );
      expect(source.getResources()).toMatchObject({active: 0, releasing: 0, uncertain: 1});
    });

    it("records a synchronous release transport failure as uncertain", async () => {
      const rpc = new JsonRpcHttpClient(["http://127.0.0.1:1"]);
      const fetch = vi.spyOn(rpc, "fetch").mockResolvedValueOnce({sessionId: "primary"});
      const factory = vi.fn(() => rpc);
      const source = new SessionPayloadSource("session", factory, {boundedAlternates: true});
      const handle = await source.prepare(buildRequest(), signal);
      factory.mockImplementationOnce(() => {
        throw new Error("transport unavailable");
      });
      await expect(source.release(handle, signal)).rejects.toThrow("transport unavailable");
      expect(source.getResources()).toMatchObject({active: 0, releasing: 0, uncertain: 1});
      fetch.mockResolvedValueOnce(true);
      await source.reconcileResources(signal);
      expect(source.getResources()).toMatchObject({uncertain: 0});
    });

    it("reconciles an absent instance-scoped handle without releasing another instance", async () => {
      const {source, fetch, request} = setup(true);
      const oldId = `native-${"ab".repeat(16)}-0-17`;
      const newId = `native-${"cd".repeat(16)}-0-17`;
      fetch.mockResolvedValueOnce({sessionId: oldId}).mockResolvedValueOnce({sessionId: newId});
      const old = await source.prepare(request, signal);
      const current = await source.prepare(request, signal);
      fetch.mockRejectedValueOnce(transportError("ECONNRESET")).mockRejectedValueOnce(transportError("ECONNRESET"));
      await expect(source.release(old, signal)).rejects.toBeInstanceOf(FetchError);
      const absent = new ErrorJsonRpcResponse(
        {jsonrpc: "2.0", id: 1, error: {code: -32000, message: "UnknownSession"}},
        "zbuilder_endV1"
      );
      fetch.mockRejectedValueOnce(absent);
      await source.reconcileResources(signal);
      expect(source.getResources()).toMatchObject({active: 1, releasing: 0, uncertain: 0});
      fetch.mockResolvedValueOnce(payloadResponse(request));
      await expect(source.getPayload(current, signal)).resolves.toMatchObject({sourceId: "session"});
      expect(
        fetch.mock.calls.filter(([call]) => call.method === "zbuilder_endV1").map(([call]) => call.params)
      ).toEqual([[oldId], [oldId], [oldId]]);
    });

    it.each([
      ["foreign-handle", -32000, "UnknownSession"],
      [`native-${"ab".repeat(16)}-2-17`, -32000, "UnknownSession"],
      [`native-${"ab".repeat(16)}-0-18446744073709551616`, -32000, "UnknownSession"],
      [`native-${"ab".repeat(16)}-0-17`, -32601, "UnknownSession"],
      [`native-${"ab".repeat(16)}-0-17`, -32000, "WorkerRejected"],
    ] as const)("keeps unconfirmed end error occupied for %s/%i/%s", async (payloadId, code, message) => {
      const {source, fetch, request} = setup(true);
      fetch.mockResolvedValueOnce({sessionId: payloadId});
      const handle = await source.prepare(request, signal);
      fetch.mockRejectedValueOnce(
        new ErrorJsonRpcResponse({jsonrpc: "2.0", id: 1, error: {code, message}}, "zbuilder_endV1")
      );
      await expect(source.release(handle, signal)).rejects.toBeInstanceOf(ErrorJsonRpcResponse);
      expect(source.getResources()).toMatchObject({active: 0, releasing: 0, uncertain: 1});
    });

    it("recovers after two real refused begin connections without losing capacity", async () => {
      const methods: string[] = [];
      const server = createServer(async (req, res) => {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const call = JSON.parse(Buffer.concat(chunks).toString()) as {id: number; method: string};
        methods.push(call.method);
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({jsonrpc: "2.0", id: call.id, result: {sessionId: `restored-${methods.length}`}}));
      });
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Missing listener address");
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
      const source = new SessionPayloadSource(
        "socket",
        (signal) => new JsonRpcHttpClient([`http://127.0.0.1:${address.port}`], {signal, timeout: 1000}),
        {boundedAlternates: true}
      );
      for (let i = 0; i < 2; i++) {
        await expect(source.prepare(buildRequest(), signal)).rejects.toMatchObject({code: "ECONNREFUSED"});
        expect(source.getResources()).toMatchObject({preparing: 0, active: 0, uncertain: 0, alternatesDisabled: false});
      }
      server.listen(address.port, "127.0.0.1");
      await once(server, "listening");
      try {
        await source.prepare(buildRequest(), signal);
        await source.prepare(buildRequest(), signal);
        expect(source.getResources()).toMatchObject({active: 2, preparing: 0, uncertain: 0, alternatesDisabled: false});
        expect(methods).toEqual(["zbuilder_beginV1", "zbuilder_beginV1"]);
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
      }
    });

    it("keeps a cancelled HTTP begin tracked until its late handle is physically released", async () => {
      const beginEntered = defer<void>();
      const beginReply = defer<void>();
      const endEntered = defer<void>();
      const endReply = defer<void>();
      const methods: string[] = [];
      const id = `native-${"ab".repeat(16)}-1-19`;
      const server = createServer(async (req, res) => {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const call = JSON.parse(Buffer.concat(chunks).toString()) as {id: number; method: string; params: unknown[]};
        methods.push(call.method);
        if (call.method === "zbuilder_beginV1") {
          beginEntered.resolve();
          await beginReply.promise;
        } else {
          expect(call).toMatchObject({method: "zbuilder_endV1", params: [id]});
          endEntered.resolve();
          await endReply.promise;
        }
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: call.id,
            result: call.method === "zbuilder_beginV1" ? {sessionId: id} : true,
          })
        );
      });
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const controller = new AbortController();
      const callSignals: AbortSignal[] = [];
      try {
        const address = server.address();
        if (!address || typeof address === "string") throw new Error("Missing listener address");
        const source = new SessionPayloadSource(
          "socket",
          (signal) => {
            callSignals.push(signal);
            return new JsonRpcHttpClient([`http://127.0.0.1:${address.port}`], {signal, timeout: 1000});
          },
          {boundedAlternates: true}
        );
        const prepare = source.prepare(buildRequest(), controller.signal);
        const cancelled = expect(prepare).rejects.toBeInstanceOf(ErrorAborted);
        await beginEntered.promise;
        controller.abort();
        expect(callSignals[0].aborted).toBe(false);
        expect(source.getResources()).toMatchObject({preparing: 1, active: 0, releasing: 0, uncertain: 0});
        beginReply.resolve();
        await endEntered.promise;
        expect(source.getResources()).toMatchObject({preparing: 0, active: 0, releasing: 1, uncertain: 0});
        endReply.resolve();
        await cancelled;
        expect(source.getResources()).toMatchObject({
          preparing: 0,
          active: 0,
          releasing: 0,
          uncertain: 0,
          alternatesDisabled: false,
        });
        expect(methods).toEqual(["zbuilder_beginV1", "zbuilder_endV1"]);
      } finally {
        beginReply.resolve();
        endReply.resolve();
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
      }
    });

    it("keeps cancelled begin ownership beyond native operation time and overrides the factory timeout", async () => {
      vi.useFakeTimers();
      const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation((milliseconds) => {
        const controller = new AbortController();
        setTimeout(() => controller.abort(new DOMException("timeout", "TimeoutError")), milliseconds);
        return controller.signal;
      });
      try {
        const rpc = new JsonRpcHttpClient(["http://127.0.0.1:1"], {timeout: 8000});
        const fetch = vi.spyOn(rpc, "fetch");
        const signals: AbortSignal[] = [];
        const source = new SessionPayloadSource(
          "session",
          (signal) => {
            signals.push(signal);
            return rpc;
          },
          {boundedAlternates: true}
        );
        const request = buildRequest();
        const controller = new AbortController();
        const ended = defer<boolean>();
        fetch
          .mockImplementationOnce((_call, opts) => {
            expect(opts).toEqual({timeout: 20_000});
            const callSignal = signals[0];
            return new Promise((resolve, reject) => {
              const reply = setTimeout(() => resolve({sessionId: "late-native-result"}), 16_000);
              callSignal.addEventListener(
                "abort",
                () => {
                  clearTimeout(reply);
                  reject(new FetchError("http://constructor", callSignal.reason));
                },
                {once: true}
              );
            });
          })
          .mockImplementationOnce(() => ended.promise);
        const preparing = source.prepare(request, controller.signal);
        const cancelled = expect(preparing).rejects.toBeInstanceOf(ErrorAborted);
        controller.abort();
        await vi.advanceTimersByTimeAsync(6001);
        expect(signals[0].aborted).toBe(false);
        expect(source.getResources()).toMatchObject({preparing: 1, active: 0, uncertain: 0});
        await vi.advanceTimersByTimeAsync(9000);
        expect(signals[0].aborted).toBe(false);
        expect(source.getResources()).toMatchObject({preparing: 1, active: 0, uncertain: 0});
        await vi.advanceTimersByTimeAsync(999);
        expect(source.getResources()).toMatchObject({preparing: 0, active: 0, releasing: 1, uncertain: 0});
        expect(fetch).toHaveBeenLastCalledWith({method: "zbuilder_endV1", params: ["late-native-result"]});
        expect(timeout.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([20_000, 6000]);
        ended.resolve(true);
        await cancelled;
        expect(source.getResources()).toMatchObject({
          preparing: 0,
          active: 0,
          releasing: 0,
          uncertain: 0,
          alternatesDisabled: false,
        });
      } finally {
        timeout.mockRestore();
        vi.useRealTimers();
      }
    });

    it.each(["unsupported", "lost-response"])("tracks real HTTP alternate begin outcome: %s", async (fault) => {
      const request = buildRequest();
      const controller = new AbortController();
      const methods: string[] = [];
      const warn = vi.fn<Logger["warn"]>();
      const server = createServer(async (req, res) => {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const call = JSON.parse(Buffer.concat(chunks).toString()) as {id: number; method: string};
        methods.push(call.method);
        if (call.method === "zbuilder_beginAlternateV1" && fault === "lost-response") {
          // The constructor received a non-idempotent allocation request.
          // Losing its reply cannot prove whether allocation took place.
          controller.abort();
          req.socket.destroy();
          return;
        }
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: call.id,
            ...(call.method === "zbuilder_beginAlternateV1"
              ? {error: {code: -32000, message: "UnknownSession"}}
              : {result: {sessionId: "primary"}}),
          })
        );
      });
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      try {
        const address = server.address();
        if (!address || typeof address === "string") throw new Error("Missing listener address");
        const source = new SessionPayloadSource(
          "socket",
          (signal) => new JsonRpcHttpClient([`http://127.0.0.1:${address.port}`], {signal, timeout: 1000}),
          {boundedAlternates: true, logger: {warn}}
        );
        await source.prepare(request, signal);
        await expect(source.prepare({...request, requireUnleased: true}, controller.signal)).rejects.toThrow();
        expect(source.getResources()).toMatchObject({
          active: 1,
          preparing: 0,
          uncertain: fault === "lost-response" ? 1 : 0,
          alternatesDisabled: true,
        });
        await source.reconcileResources(signal);
        expect(methods).toEqual(["zbuilder_beginV1", "zbuilder_beginAlternateV1"]);
        expect(warn).toHaveBeenCalledWith(
          "Constructor alternate admission disabled",
          expect.objectContaining({
            reason: fault === "lost-response" ? "ambiguous_begin" : "unsupported_alternate_method",
            callerAborted: fault === "lost-response",
            preparing: 0,
            uncertain: fault === "lost-response" ? 1 : 0,
          })
        );
        expect(warn).toHaveBeenCalledTimes(fault === "lost-response" ? 1 : 2);
        if (fault === "unsupported")
          expect(warn).toHaveBeenCalledWith(
            "Constructor begin rejected",
            expect.objectContaining({reason: "UnknownSession", cleanupPending: false})
          );
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
      }
    });

    it.each([false, true])(
      "logs a late ambiguous begin after caller cancellation (alternate=%s)",
      async (alternate) => {
        const {source, fetch, request, warn} = setup(true);
        if (alternate) {
          fetch.mockResolvedValueOnce({sessionId: "primary"});
          await source.prepare(request, signal);
        }
        const controller = new AbortController();
        const begin = defer<{sessionId: string}>();
        fetch.mockImplementationOnce(() => begin.promise);
        const failure = new Error("https://private:secret@example.invalid/rpc?token=private-order");
        const pending = source.prepare({...request, requireUnleased: alternate}, controller.signal);
        const rejected = expect(pending).rejects.toBe(failure);
        controller.abort();
        expect(warn).not.toHaveBeenCalled();
        begin.reject(failure);
        await rejected;
        expect(warn).toHaveBeenCalledExactlyOnceWith("Constructor alternate admission disabled", {
          code: "SESSION_PAYLOAD_ALTERNATES_DISABLED",
          reason: "ambiguous_begin",
          method: alternate ? "zbuilder_beginAlternateV1" : "zbuilder_beginV1",
          slot: request.payloadAttributes.slotNumber,
          parentBlockHash: request.forkchoiceState.headBlockHash,
          parentBlockRoot: toHex(request.payloadAttributes.parentBeaconBlockRoot),
          callerAborted: true,
          orphaned: 1,
          capacity: 2,
          preparing: 0,
          active: alternate ? 1 : 0,
          releasing: 0,
          uncertain: 1,
          alternatesDisabled: true,
        });
        await source.reconcileResources(signal);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(source.getResources()).toMatchObject({uncertain: 1, alternatesDisabled: true});
      }
    );

    it("preserves the original begin error and reservation when the warning logger throws", async () => {
      const {source, fetch, request, warn} = setup(true);
      const failure = new Error("response lost");
      warn.mockImplementation(() => {
        throw new Error("logger unavailable");
      });
      fetch.mockRejectedValueOnce(failure);
      await expect(source.prepare(request, signal)).rejects.toBe(failure);
      expect(source.getResources()).toMatchObject({preparing: 0, uncertain: 1, alternatesDisabled: true});
    });

    it("still releases an unconfirmed alternate capability when the warning logger throws", async () => {
      const {source, fetch, request, warn} = setup(true);
      fetch.mockResolvedValueOnce({sessionId: "primary"});
      await source.prepare(request, signal);
      warn.mockImplementation(() => {
        throw new Error("logger unavailable");
      });
      fetch.mockResolvedValueOnce({sessionId: "alternate"}).mockResolvedValueOnce(true);
      await expect(source.prepare({...request, requireUnleased: true}, signal)).rejects.toMatchObject(
        errorCode(SessionPayloadErrorCode.ALTERNATE_UNSUPPORTED)
      );
      expect(fetch).toHaveBeenLastCalledWith({method: "zbuilder_endV1", params: ["alternate"]});
      expect(source.getResources()).toMatchObject({active: 1, releasing: 0, uncertain: 0, alternatesDisabled: true});
    });

    it("retains an unknown begin outcome and never infers recovery from a session listing", async () => {
      const {source, fetch, request} = setup(true);
      fetch.mockResolvedValueOnce({sessionId: "primary"});
      const primary = await source.prepare(request, signal);
      fetch.mockRejectedValueOnce(new Error("connection timed out after send"));
      await expect(source.prepare({...request, requireUnleased: true}, signal)).rejects.toThrow("connection timed out");
      expect(source.getResources()).toMatchObject({preparing: 0, active: 1, uncertain: 1, alternatesDisabled: true});
      await source.reconcileResources(signal);
      expect(fetch).toHaveBeenCalledTimes(2);
      fetch.mockResolvedValueOnce(true);
      await source.release(primary, signal);
      expect(source.getResources()).toMatchObject({active: 0, uncertain: 1, alternatesDisabled: true});
      await expect(source.prepare({...request, requireUnleased: true}, signal)).rejects.toMatchObject(
        errorCode(SessionPayloadErrorCode.ALTERNATE_UNSUPPORTED)
      );
      fetch.mockResolvedValueOnce({sessionId: "next-primary"});
      await source.prepare(request, signal);
      await expect(source.prepare(request, signal)).rejects.toMatchObject(errorCode(SessionPayloadErrorCode.CAPACITY));
    });

    it.each([
      ["UnknownSession", -32000],
      ["AlternateLeasesUnsupported", -32000],
      ["UnknownMethod", -32000],
      ["Method not found", -32601],
    ] as const)("disables alternates on definite unsupported native response %s", async (reason, code) => {
      const {source, fetch, request} = setup(true);
      fetch.mockResolvedValueOnce({sessionId: "primary"});
      await source.prepare(request, signal);
      fetch.mockRejectedValueOnce(rejectedBegin(reason, code));
      await expect(source.prepare({...request, requireUnleased: true}, signal)).rejects.toThrow(reason);
      expect(source.getResources()).toMatchObject({active: 1, uncertain: 0, alternatesDisabled: true});
    });

    it.each(["WorkerRejected", "AlternateSessionLimit", "SessionLimit", "FileNotFound", "SyntaxError", "OutOfMemory"])(
      "allows a fresh attempt after definite native rejection %s without charging an orphan",
      async (reason) => {
        const {source, fetch, request} = setup(true);
        fetch.mockRejectedValueOnce(rejectedBegin(reason));
        await expect(source.prepare(request, signal)).rejects.toThrow(reason);
        expect(source.getResources()).toMatchObject({active: 0, uncertain: 0, alternatesDisabled: false});
        fetch.mockResolvedValueOnce({sessionId: "primary"});
        await source.prepare(request, signal);
        fetch.mockRejectedValueOnce(rejectedBegin(reason));
        await expect(source.prepare({...request, requireUnleased: true}, signal)).rejects.toThrow(reason);
        expect(source.getResources()).toMatchObject({active: 1, uncertain: 0, alternatesDisabled: false});
      }
    );

    it.each([{orderGenerationVersion: 1, alternateSessionVersion: 1}, {orderGenerationVersion: 0}, {}])(
      "cleans and disables an unconfirmed alternate capability %j",
      async (capability) => {
        const {source, fetch, request} = setup(true);
        fetch.mockResolvedValueOnce({sessionId: "primary"});
        await source.prepare(request, signal);
        fetch.mockResolvedValueOnce({sessionId: "alternate", ...capability}).mockResolvedValueOnce(true);
        await expect(source.prepare({...request, requireUnleased: true}, signal)).rejects.toMatchObject(
          errorCode(SessionPayloadErrorCode.ALTERNATE_UNSUPPORTED)
        );
        expect(fetch).toHaveBeenLastCalledWith({method: "zbuilder_endV1", params: ["alternate"]});
        expect(source.getResources()).toMatchObject({active: 1, uncertain: 0, alternatesDisabled: true});
      }
    );

    it("never ends an existing primary when an invalid begin duplicates its handle", async () => {
      const {source, fetch, request} = setup(true);
      fetch.mockResolvedValue({sessionId: "primary"});
      await source.prepare(request, signal);
      await expect(source.prepare({...request, requireUnleased: true}, signal)).rejects.toMatchObject(
        errorCode(SessionPayloadErrorCode.INVALID_SESSION)
      );
      expect(source.getResources()).toMatchObject({active: 1, uncertain: 1, alternatesDisabled: true});
      expect(fetch.mock.calls.map(([call]) => call.method)).toEqual(["zbuilder_beginV1", "zbuilder_beginAlternateV1"]);
    });

    it("retains late-cancelled known handles when their cleanup fails", async () => {
      const {source, fetch, request} = setup(true);
      const controller = new AbortController();
      fetch
        .mockImplementationOnce(async () => {
          controller.abort();
          return {sessionId: "late"};
        })
        .mockRejectedValueOnce(new Error("end lost"));
      await expect(source.prepare(request, controller.signal)).rejects.toBeInstanceOf(ErrorAborted);
      expect(source.getResources()).toMatchObject({preparing: 0, active: 0, uncertain: 1});
      fetch.mockResolvedValueOnce(true);
      await source.reconcileResources(signal);
      expect(source.getResources()).toMatchObject({uncertain: 0});
    });

    it("does not invalidate a valid lease for a foreign release handle", async () => {
      const {source, fetch, request} = setup(true);
      fetch.mockResolvedValueOnce({sessionId: "primary", orderGenerationVersion: 1});
      const handle = await source.prepare(request, signal);
      fetch.mockResolvedValueOnce({generation: "0x0", ready: true, leaseMs: 250, payload: payloadResponse(request)});
      const payload = await source.getPayload(handle, signal);
      await expect(source.release({...handle, sourceId: "other"}, signal)).rejects.toMatchObject(
        errorCode(SessionPayloadErrorCode.UNKNOWN_HANDLE)
      );
      expect(payload.offerEligibility?.lease.ready).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it("cannot revive a snapshot when its read finishes during unconfirmed cleanup", async () => {
      const {source, fetch, request} = setup(true);
      fetch.mockResolvedValueOnce({sessionId: "primary"});
      const handle = await source.prepare(request, signal);
      const read = defer<PayloadResponse>();
      fetch.mockImplementationOnce(() => read.promise).mockRejectedValueOnce(new Error("end lost"));
      const payload = source.getPayload(handle, signal);
      const rejected = expect(payload).rejects.toMatchObject(errorCode(SessionPayloadErrorCode.UNKNOWN_HANDLE));
      await expect(source.release(handle, signal)).rejects.toThrow("end lost");
      read.resolve(payloadResponse(request));
      await rejected;
      expect(source.getResources()).toMatchObject({active: 0, uncertain: 1});
    });
  });
});
