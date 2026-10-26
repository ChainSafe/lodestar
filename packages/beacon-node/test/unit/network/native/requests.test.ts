import {generateKeyPair} from "@libp2p/crypto/keys";
import {peerIdFromPublicKey} from "@libp2p/peer-id";
import {afterEach, expect, it, vi} from "vitest";
import {IncomingRequest, NativePeerOrigin, NativeResponseChunk} from "@chainsafe/lodestar-z/network";
import {createBeaconConfig} from "@lodestar/config";
import {RequestErrorCode, RespStatus, ResponseError} from "@lodestar/reqresp";
import {ErrorAborted, defer} from "@lodestar/utils";
import {outgoingNativeRequest, serveNativeRequest} from "../../../../src/network/core/native/requests.js";
import {PeerAction} from "../../../../src/network/peers/score/index.js";
import {GetReqRespHandlerFn, ReqRespMethod} from "../../../../src/network/reqresp/types.js";
import {getMockedLogger} from "../../../mocks/loggerMock.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it.each([
  [
    {reason: "local_capacity", capacityToken: "capacity-token"},
    {code: RequestErrorCode.REQUEST_LOCAL_CAPACITY, capacityToken: "capacity-token"},
  ],
  [{reason: "too_many_requests"}, {code: RequestErrorCode.REQUEST_SELF_RATE_LIMITED}],
])("preserves the scope of native admission refusal %j", async (refusal, mapped) => {
  const key = await generateKeyPair("secp256k1");
  const request = vi.fn(() => {
    throw Object.assign(new Error("full"), {code: "NetworkRequestRejected", ...refusal});
  });
  expect(() =>
    outgoingNativeRequest(
      {request},
      {
        peerId: peerIdFromPublicKey(key.publicKey).toString(),
        method: ReqRespMethod.BeaconBlocksByRoot,
        versions: [2],
        requestData: new Uint8Array(32),
      },
      vi.fn()
    )
  ).toThrow(expect.objectContaining({type: mapped}));
});

it("preserves an asynchronous capacity refusal without reporting the peer", async () => {
  const failure = Object.assign(new Error("full"), {
    code: "NetworkRequestRejected",
    reason: "local_capacity",
    capacityToken: "capacity-token",
  });
  const report = vi.fn();
  const response: AsyncIterableIterator<NativeResponseChunk> = {
    [Symbol.asyncIterator]() {
      return this;
    },
    next: () => Promise.reject(failure),
  };
  const iterator = outgoingNativeRequest(
    {request: () => response},
    {peerId: "unused", method: ReqRespMethod.BeaconBlocksByRoot, versions: [2], requestData: new Uint8Array(32)},
    report
  );
  await expect(iterator.next()).rejects.toMatchObject({
    type: {
      code: RequestErrorCode.REQUEST_LOCAL_CAPACITY,
      capacityToken: "capacity-token",
    },
  });
  expect(report).not.toHaveBeenCalled();
});

it("maps a native empty single-chunk response to EMPTY_RESPONSE", async () => {
  const key = await generateKeyPair("secp256k1");
  const failure = Object.assign(new Error("empty"), {
    code: "NetworkRequestFailed",
    reason: "empty_response",
    phase: "response",
    detail: null,
    context: null,
    peerStatus: null,
    peerMessage: null,
  });
  const response: AsyncIterableIterator<NativeResponseChunk> = {
    [Symbol.asyncIterator]() {
      return this;
    },
    next: () => Promise.reject(failure),
  };
  const iterator = outgoingNativeRequest(
    {request: vi.fn(() => response)},
    {
      peerId: peerIdFromPublicKey(key.publicKey).toString(),
      method: ReqRespMethod.BeaconBlocksByRoot,
      versions: [2],
      requestData: new Uint8Array(32),
    },
    vi.fn()
  );
  await expect(iterator.next()).rejects.toMatchObject({type: {code: RequestErrorCode.EMPTY_RESPONSE}});
});

it.each([
  ["negotiation_failed", "negotiation", "timeout", RequestErrorCode.DIAL_TIMEOUT, PeerAction.HighToleranceError],
  ["negotiation_rejected", "negotiation", null, RequestErrorCode.DIAL_ERROR, PeerAction.LowToleranceError],
  ["timeout", "negotiation", null, RequestErrorCode.DIAL_TIMEOUT, PeerAction.HighToleranceError],
  ["timeout", "request", null, RequestErrorCode.REQUEST_TIMEOUT, null],
  ["timeout", "response", null, RequestErrorCode.RESP_TIMEOUT, null],
  ["invalid_response", "response", "LengthOutOfBounds", RequestErrorCode.INVALID_RESPONSE_SSZ, null],
  ["invalid_response", "response", "BufferTooSmall", RequestErrorCode.INVALID_RESPONSE_SSZ, null],
  ["too_many_chunks", "response", null, RequestErrorCode.INVALID_RESPONSE_SSZ, null],
  ["unknown_context", "response", null, RequestErrorCode.INVALID_RESPONSE_SSZ, null],
  ["host_timeout", "response", null, RequestErrorCode.REQUEST_ERROR, null],
  ["quota_timeout", "response", null, RequestErrorCode.REQUEST_ERROR, null],
] as const)("maps and scores %s in %s once", async (reason, phase, detail, code, action) => {
  const failure = Object.assign(new Error(reason), {
    code: "NetworkRequestFailed",
    reason,
    phase,
    detail,
    peerFault: null,
    peerStatus: null,
  });
  const response: AsyncIterableIterator<NativeResponseChunk> = {
    [Symbol.asyncIterator]() {
      return this;
    },
    next: () => Promise.reject(failure),
    return: () => Promise.reject(failure),
    throw: () => Promise.reject(failure),
  };
  const report = vi.fn();
  const iterator = outgoingNativeRequest(
    {request: () => response},
    {
      peerId: "unused",
      method: ReqRespMethod.BeaconBlocksByRoot,
      versions: [2],
      requestData: new Uint8Array(32),
    },
    report
  );
  await expect(iterator.next()).rejects.toMatchObject({type: {code}});
  await expect(iterator.next()).rejects.toMatchObject({type: {code}});
  await expect(iterator.return?.()).rejects.toMatchObject({type: {code}});
  await expect(iterator.throw?.(failure)).rejects.toMatchObject({type: {code}});
  if (action === null) expect(report).not.toHaveBeenCalled();
  else expect(report).toHaveBeenCalledExactlyOnceWith(action, code);
});

it.each([
  ["protocol", "invalid_response", RequestErrorCode.INVALID_RESPONSE_SSZ],
  ["non_completion", "timeout", RequestErrorCode.RESP_TIMEOUT],
] as const)("does not score a native %s fault twice", async (peerFault, reason, code) => {
  const failure = Object.assign(new Error(reason), {
    code: "NetworkRequestFailed",
    reason,
    phase: "response",
    peerFault,
  });
  const report = vi.fn();
  const response: AsyncIterableIterator<NativeResponseChunk> = {
    [Symbol.asyncIterator]() {
      return this;
    },
    next: () => Promise.reject(failure),
  };
  const iterator = outgoingNativeRequest(
    {request: () => response},
    {peerId: "unused", method: ReqRespMethod.BeaconBlocksByRoot, versions: [2], requestData: new Uint8Array(32)},
    report
  );
  await expect(iterator.next()).rejects.toMatchObject({type: {code}});
  expect(report).not.toHaveBeenCalled();
});

it.each([
  [RespStatus.SERVER_ERROR, RequestErrorCode.SERVER_ERROR, PeerAction.MidToleranceError],
  [RespStatus.INVALID_REQUEST, RequestErrorCode.INVALID_REQUEST, PeerAction.LowToleranceError],
  [RespStatus.RESOURCE_UNAVAILABLE, RequestErrorCode.RESOURCE_UNAVAILABLE, null],
] as const)("preserves application error scoring for status %s", async (peerStatus, code, action) => {
  const failure = Object.assign(new Error("peer error"), {
    code: "NetworkRequestFailed",
    reason: "peer_error",
    phase: "response",
    peerFault: null,
    peerStatus,
    peerMessage: new Uint8Array(),
  });
  const response: AsyncIterableIterator<NativeResponseChunk> = {
    [Symbol.asyncIterator]() {
      return this;
    },
    next: () => Promise.reject(failure),
  };
  const report = vi.fn();
  const iterator = outgoingNativeRequest(
    {request: () => response},
    {peerId: "unused", method: ReqRespMethod.BeaconBlocksByRoot, versions: [2], requestData: new Uint8Array(32)},
    report
  );
  await expect(iterator.next()).rejects.toMatchObject({type: {code}});
  await expect(iterator.next()).rejects.toMatchObject({type: {code}});
  if (action === null) expect(report).not.toHaveBeenCalled();
  else expect(report).toHaveBeenCalledExactlyOnceWith(action, code);
});

it.each(["invalid_request", "invalid_request_options", "protocol_disabled", "local_capacity"])(
  "does not penalize a peer for local admission refusal: %s",
  (reason) => {
    const report = vi.fn();
    expect(() =>
      outgoingNativeRequest(
        {
          request: () => {
            throw Object.assign(new Error(reason), {
              code: "NetworkRequestRejected",
              reason,
              capacityToken: "capacity-token",
            });
          },
        },
        {peerId: "unused", method: ReqRespMethod.BeaconBlocksByRoot, versions: [2], requestData: new Uint8Array(32)},
        report
      )
    ).toThrow();
    expect(report).not.toHaveBeenCalled();
  }
);

async function incoming() {
  const key = await generateKeyPair("secp256k1");
  const closed = defer<void>();
  const permission = defer<void>();
  const written = defer<void>();
  const request: IncomingRequest = {
    peerId: peerIdFromPublicKey(key.publicKey).toString(),
    connection: {index: 0, generation: 1},
    protocol: "/eth2/beacon_chain/req/beacon_blocks_by_root/2/ssz_snappy",
    data: new Uint8Array(32),
    closed: closed.promise,
    ready: vi.fn(() => permission.promise),
    respond: vi.fn(() => written.promise),
    finish: vi.fn(() => {
      closed.resolve();
      return closed.promise;
    }),
    fail: vi.fn(() => {
      closed.resolve();
      return closed.promise;
    }),
    cancel: vi.fn(() => {
      permission.reject(Object.assign(Error("cancelled"), {code: "NetworkIncomingClosed"}));
      closed.resolve();
      return closed.promise;
    }),
  };
  return {request, closed, permission, written};
}

/** Whether `promise` settled by the next macrotask. */
async function settled(promise: Promise<unknown>): Promise<boolean> {
  let done = false;
  void promise.finally(() => {
    done = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  return done;
}

it("keeps a pending database read and iterator cleanup inside the serving callback after reset", async () => {
  const config = createBeaconConfig({}, new Uint8Array(32));
  const read = defer<void>();
  const started = defer<void>();
  const cleanup = defer<void>();
  const cleaning = defer<void>();
  const factory: GetReqRespHandlerFn = () =>
    async function* () {
      try {
        started.resolve();
        await read.promise;
        yield {data: new Uint8Array(1), boundary: config.getForkBoundaryAtEpoch(0)};
        throw Error("pulled again after reset");
      } finally {
        cleaning.resolve();
        await cleanup.promise;
      }
    };
  const {request, closed, permission} = await incoming();
  const served = serveNativeRequest(request, factory, config, getMockedLogger());
  permission.resolve();
  await started.promise;
  closed.resolve();
  expect(await settled(served)).toBe(false);
  read.resolve();
  await cleaning.promise;
  expect(await settled(served)).toBe(false);
  expect(request.respond).not.toHaveBeenCalled();
  cleanup.resolve();
  await served;
  expect(request.finish).not.toHaveBeenCalled();
  expect(request.fail).not.toHaveBeenCalled();
});

it.each(["factory", "next"] as const)(
  "logs the original %s failure once even if the error response cannot be sent",
  async (phase) => {
    const config = createBeaconConfig({}, new Uint8Array(32));
    const logger = getMockedLogger();
    const error = Object.assign(new Error("archive checksum mismatch"), {code: "Corruption"});
    const factory: GetReqRespHandlerFn = () => {
      if (phase === "factory") throw error;
      return async function* () {
        yield Promise.reject(error);
      };
    };
    const {request, permission} = await incoming();
    vi.mocked(request.fail).mockRejectedValue(Object.assign(new Error("closed"), {code: "NetworkIncomingClosed"}));
    permission.resolve();
    await serveNativeRequest(request, factory, config, logger);
    expect(logger.error).toHaveBeenCalledExactlyOnceWith(
      "Native request serving failed",
      {protocol: request.protocol, peer: request.peerId},
      error
    );
    expect(request.fail).toHaveBeenCalledExactlyOnceWith(
      RespStatus.SERVER_ERROR,
      new TextEncoder().encode("Local serving failure")
    );
  }
);

it.each([
  new ResponseError(RespStatus.SERVER_ERROR, "Invalid stored block"),
  new ResponseError(RespStatus.INVALID_REQUEST, "Invalid range"),
  new ResponseError(RespStatus.RESOURCE_UNAVAILABLE, "Unknown root"),
  new ResponseError(RespStatus.RATE_LIMITED, "Rate limited"),
])("preserves protocol errors and logs only local server errors: $status", async (error) => {
  const config = createBeaconConfig({}, new Uint8Array(32));
  const logger = getMockedLogger();
  const factory: GetReqRespHandlerFn = () =>
    async function* () {
      yield Promise.reject(error);
    };
  const {request, permission} = await incoming();
  permission.resolve();
  await serveNativeRequest(request, factory, config, logger);
  if (error.status === RespStatus.SERVER_ERROR) {
    expect(logger.error).toHaveBeenCalledExactlyOnceWith(
      "Native request serving failed",
      {protocol: request.protocol, peer: request.peerId},
      error
    );
  } else expect(logger.error).not.toHaveBeenCalled();
  expect(request.fail).toHaveBeenCalledExactlyOnceWith(error.status, new TextEncoder().encode(error.errorMessage));
});

it.each(["NetworkIncomingClosed", "NetworkClosed", "NetworkIncomingFailed"])(
  "does not log %s or construct a handler when initial credit fails",
  async (code) => {
    const config = createBeaconConfig({}, new Uint8Array(32));
    const logger = getMockedLogger();
    const factory = vi.fn<GetReqRespHandlerFn>();
    const {request} = await incoming();
    vi.mocked(request.ready).mockRejectedValue(Object.assign(new Error(code), {code, failure: "stream_closed"}));
    await serveNativeRequest(request, factory, config, logger);
    expect(logger.error).not.toHaveBeenCalled();
    expect(factory).not.toHaveBeenCalled();
  }
);

it("does not log an aborted source read as a local failure", async () => {
  const config = createBeaconConfig({}, new Uint8Array(32));
  const logger = getMockedLogger();
  const {request, permission} = await incoming();
  permission.resolve();
  await serveNativeRequest(
    request,
    () =>
      async function* () {
        yield Promise.reject(new ErrorAborted());
      },
    config,
    logger
  );
  expect(logger.error).not.toHaveBeenCalled();
});

it("waits for initial credit and each response before producing the next chunk", async () => {
  const config = createBeaconConfig({}, new Uint8Array(32));
  const input = await incoming();
  const second = defer<void>();
  vi.mocked(input.request.respond)
    .mockImplementationOnce(() => input.written.promise)
    .mockImplementationOnce(() => second.promise);
  let produced = 0;
  const factory: GetReqRespHandlerFn = () =>
    async function* () {
      for (let index = 0; index < 2; index++) {
        produced++;
        yield {data: new Uint8Array([index]), boundary: config.getForkBoundaryAtEpoch(0)};
      }
    };
  const served = serveNativeRequest(input.request, factory, config, getMockedLogger());
  expect(await settled(served)).toBe(false);
  expect(produced).toBe(0);
  input.permission.resolve();
  expect(await settled(served)).toBe(false);
  expect(produced).toBe(1);
  input.written.resolve();
  expect(await settled(served)).toBe(false);
  expect(produced).toBe(2);
  second.resolve();
  await served;
  expect(input.request.ready).toHaveBeenCalledOnce();
  expect(vi.mocked(input.request.respond).mock.calls.map(([data]) => data)).toEqual([
    new Uint8Array([0]),
    new Uint8Array([1]),
  ]);
  expect(input.request.finish).toHaveBeenCalledOnce();
});

it("releases the handler when native rejects a produced response", async () => {
  const config = createBeaconConfig({}, new Uint8Array(32));
  const input = await incoming();
  let cleaned = false;
  let produced = 0;
  const factory: GetReqRespHandlerFn = () =>
    async function* () {
      try {
        for (let i = 0; i < 2; i++) {
          produced++;
          yield {data: new Uint8Array([i]), boundary: config.getForkBoundaryAtEpoch(0)};
        }
      } finally {
        cleaned = true;
      }
    };
  vi.mocked(input.request.respond).mockRejectedValue(
    Object.assign(new Error("oversized"), {
      code: "NetworkIncomingRejected",
      reason: "chunk_too_large",
    })
  );
  input.permission.resolve();
  await serveNativeRequest(input.request, factory, config, getMockedLogger());
  expect(cleaned).toBe(true);
  expect(produced).toBe(1);
  expect(input.request.finish).not.toHaveBeenCalled();
  expect(input.request.fail).toHaveBeenCalledOnce();
});

it("preserves the failed request's origin when reporting a response error", async () => {
  const key = await generateKeyPair("secp256k1");
  const origin = {
    connection: {index: 2, generation: 4},
    endpoint: {family: 4, address: Uint8Array.of(192, 0, 2, 1), port: 9000},
  };
  const failure = Object.assign(new Error("empty"), {
    code: "NetworkRequestFailed",
    reason: "negotiation_rejected",
    phase: "response",
    origin,
    peerFault: null,
  });
  const response: AsyncIterableIterator<NativeResponseChunk> = {
    [Symbol.asyncIterator]() {
      return this;
    },
    next: () => Promise.reject(failure),
  };
  const report = vi.fn();
  const iterator = outgoingNativeRequest(
    {request: () => response},
    {
      peerId: peerIdFromPublicKey(key.publicKey).toString(),
      method: ReqRespMethod.BeaconBlocksByRoot,
      versions: [2],
      requestData: new Uint8Array(32),
    },
    report
  );
  await expect(iterator.next()).rejects.toMatchObject({type: {code: RequestErrorCode.DIAL_ERROR}});
  expect(report).toHaveBeenCalledWith(expect.anything(), RequestErrorCode.DIAL_ERROR, origin);
});

it("delivers the response origin for host validation after the request retires", async () => {
  const origin: NativePeerOrigin = {
    connection: {index: 2, generation: 4},
    endpoint: {family: 4, address: Uint8Array.of(192, 0, 2, 1), port: 9000},
  };
  const protocol = "/eth2/beacon_chain/req/beacon_blocks_by_root/2/ssz_snappy";
  const response = (async function* (): AsyncGenerator<NativeResponseChunk> {
    yield {data: new Uint8Array(1), fork: "phase0", protocol, origin};
  })();
  const report = vi.fn();
  const iterator = outgoingNativeRequest(
    {request: () => response},
    {peerId: "peer", method: ReqRespMethod.BeaconBlocksByRoot, versions: [2], requestData: new Uint8Array(32)},
    report
  );
  const received = await iterator.next();
  await iterator.return?.();
  expect(received.value?.peerReportContext).toEqual({origin, reason: "reqresp_response"});
  expect(report).not.toHaveBeenCalled();
});
