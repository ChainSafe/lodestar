import {generateKeyPair} from "@libp2p/crypto/keys";
import {peerIdFromPublicKey} from "@libp2p/peer-id";
import {afterEach, expect, it, vi} from "vitest";
import {NativeIncomingRequest, NativeResponseChunk} from "@chainsafe/lodestar-z/network";
import {RequestErrorCode} from "@lodestar/reqresp";
import {defer} from "@lodestar/utils";
import {nativeProtocols} from "../../../../src/network/core/native/protocols.js";
import {NativeRequests, outgoingNativeRequest} from "../../../../src/network/core/native/requests.js";
import {HostServingBudget} from "../../../../src/network/reqresp/serving/budget.js";
import * as handlers from "../../../../src/network/reqresp/serving/handler.js";
import {resolveServingPolicy} from "../../../../src/network/reqresp/serving/policy.js";
import {ReqRespMethod} from "../../../../src/network/reqresp/types.js";
import {servingConfig} from "../../../utils/network/reqresp/servingCases.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("maps native admission refusal to local request rate limiting", async () => {
  const key = await generateKeyPair("secp256k1");
  const config = servingConfig();
  const request = vi.fn(() => {
    throw Object.assign(new Error("full"), {code: "NetworkRequestRejected", reason: "slots_exhausted"});
  });
  expect(() =>
    outgoingNativeRequest(
      {request},
      nativeProtocols(config, config.getForkName(0)),
      {
        peerId: peerIdFromPublicKey(key.publicKey).toString(),
        method: ReqRespMethod.BeaconBlocksByRoot,
        versions: [2],
        requestData: new Uint8Array(32),
      },
      {}
    )
  ).toThrow(expect.objectContaining({type: {code: RequestErrorCode.REQUEST_SELF_RATE_LIMITED}}));
});

it("maps a native empty single-chunk response to EMPTY_RESPONSE", async () => {
  const key = await generateKeyPair("secp256k1");
  const config = servingConfig();
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
    nativeProtocols(config, config.getForkName(0)),
    {
      peerId: peerIdFromPublicKey(key.publicKey).toString(),
      method: ReqRespMethod.BeaconBlocksByRoot,
      versions: [2],
      requestData: new Uint8Array(32),
    },
    {}
  );
  await expect(iterator.next()).rejects.toMatchObject({type: {code: RequestErrorCode.EMPTY_RESPONSE}});
});

async function incoming() {
  const key = await generateKeyPair("secp256k1");
  const closed = defer<void>();
  const permission = defer<void>();
  const written = defer<void>();
  const request: NativeIncomingRequest = {
    peerId: peerIdFromPublicKey(key.publicKey).toString(),
    connection: {index: 0, generation: 1},
    protocol: "/eth2/beacon_chain/req/beacon_blocks_by_root/2/ssz_snappy",
    data: new Uint8Array(32),
    closed: closed.promise,
    retainUntil: vi.fn(),
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
      permission.reject(Error("cancelled"));
      closed.resolve();
      return closed.promise;
    }),
  };
  return {request, closed, permission, written};
}

it.each([true, false])("contains request-copy failure but escalates an invariant failure: local=%s", (local) => {
  const config = servingConfig();
  const budget = HostServingBudget.forEnvironment(resolveServingPolicy(config, {boundedReadVersion: 1}, 1, 0));
  vi.spyOn(handlers, "servingBudget").mockReturnValue(budget);
  const error = Object.assign(new Error("copy failed"), {
    code: local ? "NetworkResultAllocationFailed" : "InvalidIncomingHandle",
  });
  const takeIncomingRequest = vi
    .fn<() => NativeIncomingRequest | null>()
    .mockImplementationOnce(() => {
      throw error;
    })
    .mockReturnValue(null);
  const onFailure = vi.fn();
  const owner = new NativeRequests(
    {takeIncomingRequest},
    config,
    vi.fn<handlers.BoundedReqRespHandlers>(),
    1,
    onFailure
  );
  try {
    expect(owner.drain(8)).toBe(false);
    expect(takeIncomingRequest).toHaveBeenCalledTimes(local ? 2 : 1);
    if (local) expect(onFailure).not.toHaveBeenCalled();
    else expect(onFailure).toHaveBeenCalledExactlyOnceWith(error);
  } finally {
    owner.close();
  }
});

it("waits for quota before producing data and for host retirement before taking another request", async () => {
  const config = servingConfig();
  const budget = HostServingBudget.forEnvironment(resolveServingPolicy(config, {boundedReadVersion: 1}, 1, 0));
  vi.spyOn(handlers, "servingBudget").mockReturnValue(budget);
  const ancillary = defer<void>();
  const first = await incoming();
  const second = await incoming();
  const queue = [first.request, second.request];
  const takeIncomingRequest = vi.fn(() => queue.shift() ?? null);
  let produced = 0;
  const active: handlers.ServingHandler[] = [];
  const factory: handlers.BoundedReqRespHandlers = () => () => {
    const handler = handlers.startServingHandler(budget, (context) =>
      (async function* () {
        produced++;
        void context.read(() => ancillary.promise).catch(() => {});
        yield {data: new Uint8Array(1), boundary: {fork: config.getForkName(0), epoch: 0}};
      })()
    );
    active.push(handler);
    return handler;
  };
  const owner = new NativeRequests({takeIncomingRequest}, config, factory, 32, vi.fn());
  try {
    expect(owner.drain(8)).toBe(false);
    expect(takeIncomingRequest).toHaveBeenCalledTimes(1);
    expect(first.request.retainUntil).toHaveBeenCalledWith(active[0].retired);
    expect(produced).toBe(0);
    first.permission.resolve();
    await vi.waitFor(() => expect(first.request.respond).toHaveBeenCalledOnce());
    expect(produced).toBe(1);
    first.closed.resolve();
    await vi.waitFor(() => expect(budget.snapshot().outstandingRetirements).toBe(1));
    expect(owner.drain(8)).toBe(false);
    expect(takeIncomingRequest).toHaveBeenCalledTimes(1);
    ancillary.resolve();
    first.written.resolve();
    await vi.waitFor(() => expect(second.request.ready).toHaveBeenCalledOnce());
    expect(takeIncomingRequest).toHaveBeenCalledTimes(2);
    expect(first.request.fail).not.toHaveBeenCalled();
  } finally {
    ancillary.resolve();
    first.written.resolve();
    owner.close();
    await Promise.all(active.map((handler) => handler.retired));
  }
  expect(budget.snapshot().occupancy).toBe(0);
});

it("waits on an earlier adapter's reservation with one cancellable retry", async () => {
  const config = servingConfig();
  const budget = HostServingBudget.forEnvironment(resolveServingPolicy(config, {boundedReadVersion: 1}, 1, 0));
  vi.spyOn(handlers, "servingBudget").mockReturnValue(budget);
  const previous = budget.acquire();
  const takeIncomingRequest = vi.fn(() => null);
  const factory: handlers.BoundedReqRespHandlers = () => () => {
    throw Error("No request available");
  };
  vi.useFakeTimers();
  const owner = new NativeRequests({takeIncomingRequest}, config, factory, 32, vi.fn());
  try {
    for (let turn = 0; turn < 100; turn++) expect(owner.drain(8)).toBe(false);
    expect(takeIncomingRequest).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);
    previous.finish();
    await vi.advanceTimersByTimeAsync(25);
    expect(takeIncomingRequest).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    const held = budget.acquire();
    owner.drain(8);
    expect(vi.getTimerCount()).toBe(1);
    owner.close();
    expect(vi.getTimerCount()).toBe(0);
    held.finish();
  } finally {
    previous.finish();
    owner.close();
  }
});

it("two peers waiting on eight response writes do not prevent a third peer from producing", async () => {
  const config = servingConfig();
  const budget = HostServingBudget.forEnvironment(resolveServingPolicy(config, {boundedReadVersion: 1}, 32, 0));
  vi.spyOn(handlers, "servingBudget").mockReturnValue(budget);
  const inputs = await Promise.all(Array.from({length: 9}, () => incoming()));
  for (let i = 1; i < 8; i++) inputs[i].request = {...inputs[i].request, peerId: inputs[i < 4 ? 0 : 4].request.peerId};
  const queue = inputs.map((input) => input.request);
  const active: handlers.ServingHandler[] = [];
  const factory: handlers.BoundedReqRespHandlers = (method) => (_request, peer) => {
    const handler = handlers.startServingHandler(
      budget,
      async function* () {
        yield {data: new Uint8Array(1), boundary: {fork: config.getForkName(0), epoch: 0}};
      },
      undefined,
      peer.toString(),
      method
    );
    active.push(handler);
    return handler;
  };
  const owner = new NativeRequests({takeIncomingRequest: () => queue.shift() ?? null}, config, factory, 32, vi.fn());
  try {
    owner.drain(32);
    expect(budget.snapshot()).toMatchObject({occupancy: 9, working: 0});
    for (const input of inputs.slice(0, 8)) input.permission.resolve();
    await vi.waitFor(() => {
      for (const input of inputs.slice(0, 8)) expect(input.request.respond).toHaveBeenCalledOnce();
    });
    expect(budget.snapshot().working).toBe(0);
    inputs[8].permission.resolve();
    await vi.waitFor(() => expect(inputs[8].request.respond).toHaveBeenCalledOnce());
    expect(budget.snapshot().reservedBytes).toBeLessThanOrEqual(budget.snapshot().limits.totalBytes);
  } finally {
    for (const input of inputs) input.written.resolve();
    owner.close();
    await Promise.all(active.map((handler) => handler.retired));
  }
});

it("requests waiting for retained memory leave native credit available to existing responses", async () => {
  const config = servingConfig();
  const basic = resolveServingPolicy(config, {boundedReadVersion: 1}, 3, 0);
  const budget = HostServingBudget.forEnvironment(
    resolveServingPolicy(config, {boundedReadVersion: 1}, 3, 0, {
      totalBytes: 3 * basic.stateBytes + 5 * basic.sourceBytes,
    })
  );
  vi.spyOn(handlers, "servingBudget").mockReturnValue(budget);
  const inputs = await Promise.all(Array.from({length: 3}, () => incoming()));
  const queue = inputs.map((input) => input.request);
  const active: handlers.ServingHandler[] = [];
  const factory: handlers.BoundedReqRespHandlers = (method) => (_request, peer) => {
    const handler = handlers.startServingHandler(
      budget,
      async function* () {
        yield {data: new Uint8Array(1), boundary: {fork: config.getForkName(0), epoch: 0}};
      },
      undefined,
      peer.toString(),
      method
    );
    active.push(handler);
    return handler;
  };
  const owner = new NativeRequests({takeIncomingRequest: () => queue.shift() ?? null}, config, factory, 3, vi.fn());
  try {
    owner.drain(3);
    inputs[0].permission.resolve();
    inputs[1].permission.resolve();
    await vi.waitFor(() => {
      expect(inputs[0].request.respond).toHaveBeenCalledOnce();
      expect(inputs[1].request.respond).toHaveBeenCalledOnce();
    });
    expect(budget.snapshot()).toMatchObject({working: 0, waiting: 1});
    expect(inputs[2].request.ready).not.toHaveBeenCalled();
    inputs[0].written.resolve();
    await vi.waitFor(() => expect(inputs[2].request.ready).toHaveBeenCalledOnce());
    expect(inputs[0].request.finish).toHaveBeenCalledOnce();
    expect(budget.snapshot().working).toBe(0);
    inputs[2].permission.resolve();
    await vi.waitFor(() => expect(inputs[2].request.respond).toHaveBeenCalledOnce());
  } finally {
    for (const input of inputs) {
      input.permission.resolve();
      input.written.resolve();
    }
    owner.close();
    await Promise.all(active.map((handler) => handler.retired));
  }
  expect(budget.snapshot()).toMatchObject({occupancy: 0, working: 0, waiting: 0, reservedBytes: 0});
});
