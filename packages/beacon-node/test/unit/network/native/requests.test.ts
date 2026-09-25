import {generateKeyPair} from "@libp2p/crypto/keys";
import {peerIdFromPublicKey} from "@libp2p/peer-id";
import {afterEach, expect, it, vi} from "vitest";
import {NativeIncomingRequest, NativeResponseChunk} from "@chainsafe/lodestar-z/network";
import {RequestErrorCode} from "@lodestar/reqresp";
import {defer} from "@lodestar/utils";
import {NativeClaim} from "../../../../src/network/core/native/drain.js";
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

function claims(requests: NativeIncomingRequest[]): NativeClaim<NativeIncomingRequest>[] {
  return requests.map((request) => new NativeClaim(request));
}

/** One turn's serving: native delivers up to the quota and the host's capacity from `queue`, and the host starts them. */
function serveTurn(owner: NativeRequests, queue: NativeIncomingRequest[], quota = 8, deadline = Infinity): number {
  const taken = queue.splice(0, Math.min(quota, owner.capacity()));
  owner.start(claims(taken), deadline);
  return taken.length;
}

it("waits for quota before producing data and for host retirement before taking another request", async () => {
  const config = servingConfig();
  const budget = HostServingBudget.forEnvironment(resolveServingPolicy(config, {boundedReadVersion: 1}, 1, 0));
  vi.spyOn(handlers, "servingBudget").mockReturnValue(budget);
  const ancillary = defer<void>();
  const first = await incoming();
  const second = await incoming();
  const queue = [first.request, second.request];
  let taken = 0;
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
  // Retirement schedules the core drain instead of taking the next request inline.
  const takenAtWake: number[] = [];
  const wake = vi.fn(() => {
    takenAtWake.push(taken);
    setImmediate(() => {
      taken += serveTurn(owner, queue);
    });
  });
  const owner = new NativeRequests(config, factory, 32, wake);
  try {
    taken += serveTurn(owner, queue);
    expect(taken).toBe(1);
    expect(first.request.retainUntil).toHaveBeenCalledWith(active[0].retired);
    expect(produced).toBe(0);
    first.permission.resolve();
    await vi.waitFor(() => expect(first.request.respond).toHaveBeenCalledOnce());
    expect(produced).toBe(1);
    first.closed.resolve();
    await vi.waitFor(() => expect(budget.snapshot().outstandingRetirements).toBe(1));
    taken += serveTurn(owner, queue);
    expect(taken).toBe(1);
    ancillary.resolve();
    first.written.resolve();
    await vi.waitFor(() => expect(second.request.ready).toHaveBeenCalledOnce());
    expect(takenAtWake).toEqual([1]);
    expect(taken).toBe(2);
    expect(first.request.fail).not.toHaveBeenCalled();
  } finally {
    ancillary.resolve();
    first.written.resolve();
    owner.close();
    await Promise.all(active.map((handler) => handler.retired));
  }
  expect(budget.snapshot().occupancy).toBe(0);
});

it("reports no serving capacity while an earlier adapter holds the shared budget, without a timer of its own", async () => {
  const config = servingConfig();
  const budget = HostServingBudget.forEnvironment(resolveServingPolicy(config, {boundedReadVersion: 1}, 1, 0));
  vi.spyOn(handlers, "servingBudget").mockReturnValue(budget);
  const previous = budget.acquire();
  const factory: handlers.BoundedReqRespHandlers = () => () => {
    throw Error("No request available");
  };
  vi.useFakeTimers();
  const owner = new NativeRequests(config, factory, 32, vi.fn());
  try {
    expect(owner.capacity()).toBe(0);
    owner.start([], Infinity);
    expect(vi.getTimerCount()).toBe(0);
    previous.finish();
    expect(owner.capacity()).toBe(1);
    owner.close();
    expect(owner.capacity()).toBe(0);
  } finally {
    previous.finish();
    owner.close();
  }
});

it("leaves starts it never adopted, once closed, for the pump to cancel", async () => {
  const config = servingConfig();
  const budget = HostServingBudget.forEnvironment(resolveServingPolicy(config, {boundedReadVersion: 1}, 1, 0));
  vi.spyOn(handlers, "servingBudget").mockReturnValue(budget);
  const owner = new NativeRequests(
    config,
    () => () => {
      throw Error("No request available");
    },
    32,
    vi.fn()
  );
  owner.close();
  const delivered = claims([(await incoming()).request]);
  expect(owner.start(delivered, Infinity)).toBe(false);
  expect(delivered[0].adopted).toBe(false);
  expect(delivered[0].item.cancel).not.toHaveBeenCalled();
});

it("holds serving starts once the drain budget is spent and starts them first in the next drain", async () => {
  const config = servingConfig();
  const budget = HostServingBudget.forEnvironment(resolveServingPolicy(config, {boundedReadVersion: 1}, 8, 0));
  vi.spyOn(handlers, "servingBudget").mockReturnValue(budget);
  const inputs = await Promise.all(Array.from({length: 6}, () => incoming()));
  const queue = inputs.map((input) => input.request);
  let started = 0;
  const factory: handlers.BoundedReqRespHandlers = () => () => {
    started++;
    throw Error("Started");
  };
  const owner = new NativeRequests(config, factory, 32, vi.fn());
  try {
    // Settlement and peers spent the budget: the host adopts the delivered starts and holds them for the next turn,
    // which follows at once.
    const held = claims(queue.splice(0, 3));
    expect(owner.start(held, 0)).toBe(true);
    expect(held.every(({adopted}) => adopted)).toBe(true);
    expect(started).toBe(0);
    // Held starts count against the next turn's capacity and start before its new ones.
    expect(owner.capacity()).toBe(5);
    expect(serveTurn(owner, queue, 2)).toBe(2);
    expect(started).toBe(5);
    for (const input of inputs.slice(0, 5)) expect(input.request.fail).toHaveBeenCalledOnce();
    void inputs[5].permission.promise.catch(() => {});
    expect(owner.start(claims(queue.splice(0, 1)), 0)).toBe(true);
  } finally {
    owner.close();
  }
  // A held start is still the host's: closing cancels it.
  expect(started).toBe(5);
  expect(inputs[5].request.cancel).toHaveBeenCalledOnce();
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
  const owner = new NativeRequests(config, factory, 32, vi.fn());
  try {
    serveTurn(owner, queue, 32);
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
  const owner = new NativeRequests(config, factory, 3, vi.fn());
  try {
    serveTurn(owner, queue, 3);
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
