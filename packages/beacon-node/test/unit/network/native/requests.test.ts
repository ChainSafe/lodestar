import {generateKeyPair} from "@libp2p/crypto/keys";
import {peerIdFromPublicKey} from "@libp2p/peer-id";
import {afterEach, expect, it, vi} from "vitest";
import {IncomingRequest, NativeResponseChunk} from "@chainsafe/lodestar-z/network";
import {RequestErrorCode, RespStatus} from "@lodestar/reqresp";
import {defer, toRootHex} from "@lodestar/utils";
import {BeaconChain} from "../../../../src/chain/chain.js";
import {IBeaconChain} from "../../../../src/chain/interface.js";
import {NativeRequests, outgoingNativeRequest} from "../../../../src/network/core/native/requests.js";
import {PeerAction} from "../../../../src/network/peers/score/index.js";
import {onBeaconBlocksByRoot} from "../../../../src/network/reqresp/handlers/beaconBlocksByRoot.js";
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
  const request = vi.fn(() => {
    throw Object.assign(new Error("full"), {code: "NetworkRequestRejected", reason: "slots_exhausted"});
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
  ).toThrow(expect.objectContaining({type: {code: RequestErrorCode.REQUEST_SELF_RATE_LIMITED}}));
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
  ["timeout", "response", null, RequestErrorCode.RESP_TIMEOUT, PeerAction.MidToleranceError],
  ["invalid_response", "response", null, RequestErrorCode.INVALID_RESPONSE_SSZ, PeerAction.LowToleranceError],
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

it.each(["protocol", "non_completion"])("does not score a native %s fault twice", async (peerFault) => {
  const failure = Object.assign(new Error("invalid response"), {
    code: "NetworkRequestFailed",
    reason: "invalid_response",
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
  await expect(iterator.next()).rejects.toMatchObject({type: {code: RequestErrorCode.INVALID_RESPONSE_SSZ}});
  expect(report).not.toHaveBeenCalled();
});

it.each(["invalid_request", "invalid_request_options", "protocol_disabled", "slots_exhausted"])(
  "does not penalize a peer for local admission refusal: %s",
  (reason) => {
    const report = vi.fn();
    expect(() =>
      outgoingNativeRequest(
        {
          request: () => {
            throw Object.assign(new Error(reason), {code: "NetworkRequestRejected", reason});
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
      permission.reject(Error("cancelled"));
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

it("produces after native credit and keeps capacity charged past stream close until child work retires", async () => {
  const config = servingConfig();
  const budget = HostServingBudget.forEnvironment(resolveServingPolicy(config, 1, 0));
  const child = defer<void>();
  let produced = 0;
  const active: handlers.ServingHandler[] = [];
  const factory: handlers.BoundedReqRespHandlers = () => () => {
    const handler = handlers.startServingHandler(budget, (context) =>
      (async function* () {
        produced++;
        void context.read(() => child.promise).catch(() => {});
        yield {data: new Uint8Array(1), boundary: {fork: config.getForkName(0), epoch: 0}};
      })()
    );
    active.push(handler);
    return handler;
  };
  const owner = new NativeRequests(config, {getHandler: factory, budget}, 32);
  const {request, closed, permission, written} = await incoming();
  try {
    const served = owner.serve(request);
    expect(owner.capacity()).toBe(0);
    expect(produced).toBe(0);
    permission.resolve();
    await vi.waitFor(() => expect(request.respond).toHaveBeenCalledOnce());
    expect(produced).toBe(1);
    // The stream closes while the response write and a child read of its handler are unresolved.
    closed.resolve();
    await vi.waitFor(() => expect(budget.snapshot().outstandingRetirements).toBe(1));
    expect(await settled(served)).toBe(false);
    expect(owner.capacity()).toBe(0);
    written.resolve();
    expect(await settled(served)).toBe(false);
    child.resolve();
    await served;
    expect(owner.capacity()).toBe(1);
    expect(request.fail).not.toHaveBeenCalled();
  } finally {
    child.resolve();
    written.resolve();
    owner.close();
    await Promise.all(active.map((handler) => handler.retired));
  }
  expect(budget.snapshot().occupancy).toBe(0);
});

/** The serving gauges' samples, after checking their families and types. */
function servingGauges(text: string): {total: number; source: number; pending: number} {
  expect(text.match(/^# TYPE .*$/gm)).toEqual([
    "# TYPE beacon_reqresp_host_serving_reserved_bytes gauge",
    "# TYPE beacon_reqresp_host_serving_source_pending_bytes gauge",
  ]);
  const samples = new Map(
    text
      .split("\n")
      .filter((line) => line !== "" && !line.startsWith("#"))
      .map((line) => {
        const [name, value] = line.split(" ");
        return [name, Number(value)];
      })
  );
  expect([...samples.keys()]).toEqual([
    'beacon_reqresp_host_serving_reserved_bytes{scope="total"}',
    'beacon_reqresp_host_serving_reserved_bytes{scope="source"}',
    "beacon_reqresp_host_serving_source_pending_bytes",
  ]);
  return {
    total: samples.get('beacon_reqresp_host_serving_reserved_bytes{scope="total"}') ?? NaN,
    source: samples.get('beacon_reqresp_host_serving_reserved_bytes{scope="source"}') ?? NaN,
    pending: samples.get("beacon_reqresp_host_serving_source_pending_bytes") ?? NaN,
  };
}

it("reports a cancelled request's serving charges, to a later adapter too, until its held source read retires", async () => {
  const config = servingConfig();
  const budget = HostServingBudget.forEnvironment(resolveServingPolicy(config, 1, 0));
  const held = defer<Uint8Array>();
  const factory: handlers.BoundedReqRespHandlers = () => () =>
    handlers.startServingHandler(budget, (context) =>
      (async function* () {
        const data = await context.read(() => held.promise, 1024);
        yield {data, boundary: {fork: config.getForkName(0), epoch: 0}};
      })()
    );
  const owner = new NativeRequests(config, {getHandler: factory, budget}, 32);
  expect(servingGauges(owner.metrics())).toEqual({total: 0, source: 0, pending: 0});
  const {request, permission} = await incoming();
  const served = owner.serve(request);
  permission.resolve();
  await vi.waitFor(() => expect(budget.snapshot().working).toBe(1));
  const {reservedBytes, reservedSourceBytes} = budget.snapshot();
  const charged = {total: reservedBytes, source: reservedSourceBytes, pending: 1024};
  expect(charged.source).toBeGreaterThan(0);
  expect(charged.total).toBeGreaterThan(charged.source);
  expect(servingGauges(owner.metrics())).toEqual(charged);
  // The adapter closes, cancelling the request while its source read is held; a successor reports the same charges.
  owner.close();
  expect(request.cancel).toHaveBeenCalledOnce();
  const successor = new NativeRequests(config, {getHandler: factory, budget}, 32);
  await vi.waitFor(() => expect(budget.snapshot().outstandingRetirements).toBe(1));
  expect(servingGauges(successor.metrics())).toEqual(charged);
  held.resolve(new Uint8Array(1));
  await served;
  expect(servingGauges(successor.metrics())).toEqual({total: 0, source: 0, pending: 0});
  expect(request.respond).not.toHaveBeenCalled();
});

it("answers a stored block exceeding its native read bound with SERVER_ERROR", async () => {
  const config = servingConfig();
  const budget = HostServingBudget.forEnvironment(resolveServingPolicy(config, 1, 0));
  const root = new Uint8Array(32).fill(3);
  const getBinary = vi.fn(async () => {
    throw Object.assign(new Error("ValueTooLarge"), {code: "ValueTooLarge"});
  });
  const chain = {
    config,
    db: {block: {getBinary}},
    seenBlockInputCache: {get: () => undefined},
    forkChoice: {getBlockHexDefaultStatus: () => ({blockRoot: toRootHex(root), slot: 1})},
  };
  (chain as unknown as IBeaconChain).getSerializedBlockByRoot = BeaconChain.prototype.getSerializedBlockByRoot;
  const factory: handlers.BoundedReqRespHandlers = () => () =>
    handlers.startServingHandler(budget, (context) =>
      onBeaconBlocksByRoot([root], chain as unknown as IBeaconChain, context)
    );
  const {request, permission} = await incoming();
  const owner = new NativeRequests(config, {getHandler: factory, budget}, 32);
  permission.resolve();
  await owner.serve(request);
  expect(request.fail).toHaveBeenCalledExactlyOnceWith(RespStatus.RESOURCE_UNAVAILABLE, expect.any(Uint8Array));
  expect(new TextDecoder().decode(vi.mocked(request.fail).mock.calls[0][1])).toBe(
    "Requested data exceeds serving limits"
  );
  expect(getBinary).toHaveBeenCalledExactlyOnceWith(
    root,
    expect.objectContaining({fillCache: false, maxValueBytes: config.MAX_PAYLOAD_SIZE})
  );
  expect(request.respond).not.toHaveBeenCalled();
  expect(budget.snapshot().occupancy).toBe(0);
});

it("reports no serving capacity while an earlier adapter holds the shared budget, without a timer of its own", async () => {
  const config = servingConfig();
  const budget = HostServingBudget.forEnvironment(resolveServingPolicy(config, 1, 0));
  const previous = budget.acquire();
  vi.useFakeTimers();
  const owner = new NativeRequests(
    config,
    {
      budget,
      getHandler: () => () => {
        throw Error("No request available");
      },
    },
    32
  );
  try {
    expect(owner.capacity()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    previous.finish();
    expect(owner.capacity()).toBe(1);
  } finally {
    previous.finish();
    owner.close();
  }
});

it("cancels a handler when its stream closes, and every served request at close", async () => {
  const config = servingConfig();
  const budget = HostServingBudget.forEnvironment(resolveServingPolicy(config, 2, 0));
  const active: handlers.ServingHandler[] = [];
  const factory: handlers.BoundedReqRespHandlers = () => () => {
    const handler = handlers.startServingHandler(budget, async function* () {
      yield {data: new Uint8Array(1), boundary: {fork: config.getForkName(0), epoch: 0}};
    });
    active.push(handler);
    return handler;
  };
  const owner = new NativeRequests(config, {getHandler: factory, budget}, 32);
  const [first, second] = await Promise.all([incoming(), incoming()]);
  const served = [owner.serve(first.request), owner.serve(second.request)];
  expect(owner.capacity()).toBe(0);
  // The first stream closes before native credit arrives: its handler retires without producing.
  first.closed.resolve();
  first.permission.reject(Error("closed"));
  await served[0];
  expect(first.request.respond).not.toHaveBeenCalled();
  expect(owner.capacity()).toBe(1);
  owner.close();
  expect(second.request.cancel).toHaveBeenCalledOnce();
  await served[1];
  expect(second.request.respond).not.toHaveBeenCalled();
  expect(budget.snapshot().occupancy).toBe(0);
  await Promise.all(active.map((handler) => handler.retired));
});

it("two peers waiting on eight response writes do not prevent a third peer from producing", async () => {
  const config = servingConfig();
  const budget = HostServingBudget.forEnvironment(resolveServingPolicy(config, 32, 0));
  const inputs = await Promise.all(Array.from({length: 9}, () => incoming()));
  for (let i = 1; i < 8; i++) inputs[i].request = {...inputs[i].request, peerId: inputs[i < 4 ? 0 : 4].request.peerId};
  const active: handlers.ServingHandler[] = [];
  const factory: handlers.BoundedReqRespHandlers = (method) => (_request, peer) => {
    const handler = handlers.startServingHandler(
      budget,
      async function* () {
        yield {data: new Uint8Array(1), boundary: {fork: config.getForkName(0), epoch: 0}};
      },
      peer.toString(),
      method
    );
    active.push(handler);
    return handler;
  };
  const owner = new NativeRequests(config, {getHandler: factory, budget}, 32);
  try {
    for (const input of inputs) void owner.serve(input.request);
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
  const basic = resolveServingPolicy(config, 3, 0);
  const budget = HostServingBudget.forEnvironment(
    resolveServingPolicy(config, 3, 0, {
      // Room for two by-root responses under the largest retained charge, a block range's
      totalBytes:
        3 * basic.stateBytes +
        basic.workingBytes +
        (basic.methods[ReqRespMethod.BeaconBlocksByRange]?.retainedBytes ?? 0),
    })
  );
  const inputs = await Promise.all(Array.from({length: 3}, () => incoming()));
  const active: handlers.ServingHandler[] = [];
  const factory: handlers.BoundedReqRespHandlers = (method) => (_request, peer) => {
    const handler = handlers.startServingHandler(
      budget,
      async function* () {
        yield {data: new Uint8Array(1), boundary: {fork: config.getForkName(0), epoch: 0}};
      },
      peer.toString(),
      method
    );
    active.push(handler);
    return handler;
  };
  const owner = new NativeRequests(config, {getHandler: factory, budget}, 3);
  try {
    for (const input of inputs) void owner.serve(input.request);
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

it("waits for initial credit once and each response before producing the next chunk", async () => {
  const config = servingConfig();
  const budget = HostServingBudget.forEnvironment(resolveServingPolicy(config, 1, 0));
  const input = await incoming();
  const second = defer<void>();
  vi.mocked(input.request.respond)
    .mockImplementationOnce(() => input.written.promise)
    .mockImplementationOnce(() => second.promise);
  let produced = 0;
  const handler = handlers.startServingHandler(budget, async function* () {
    for (let index = 0; index < 2; index++) {
      produced++;
      yield {data: new Uint8Array(1), boundary: {fork: config.getForkName(0), epoch: 0}};
    }
  });
  const owner = new NativeRequests(config, {getHandler: () => () => handler, budget}, 1);
  const served = owner.serve(input.request);
  try {
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
    expect(input.request.respond).toHaveBeenCalledTimes(2);
    expect(input.request.finish).toHaveBeenCalledOnce();
  } finally {
    input.permission.resolve();
    input.written.resolve();
    second.resolve();
    owner.close();
    await handler.retired;
  }
});
