import {generateKeyPair} from "@libp2p/crypto/keys";
import {peerIdFromPublicKey} from "@libp2p/peer-id";
import {afterEach, expect, it, vi} from "vitest";
import {IncomingRequest, NativeResponseChunk} from "@chainsafe/lodestar-z/network";
import {RequestErrorCode, RespStatus} from "@lodestar/reqresp";
import {defer, toRootHex} from "@lodestar/utils";
import {BeaconChain} from "../../../../src/chain/chain.js";
import {IBeaconChain} from "../../../../src/chain/interface.js";
import {nativeProtocols} from "../../../../src/network/core/native/protocols.js";
import {NativeRequests, outgoingNativeRequest} from "../../../../src/network/core/native/requests.js";
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
  vi.spyOn(handlers, "servingBudget").mockReturnValue(budget);
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
  const owner = new NativeRequests(config, factory, 32);
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

it("answers an uncertified stored block with RESOURCE_UNAVAILABLE before reading it", async () => {
  const config = servingConfig();
  const budget = HostServingBudget.forEnvironment(resolveServingPolicy(config, 1, 0));
  vi.spyOn(handlers, "servingBudget").mockReturnValue(budget);
  const root = new Uint8Array(32).fill(3);
  const getBinary = vi.fn(async () => new Uint8Array(1));
  // A hot block in fork choice, while this run's hot scan has not passed
  const chain = {
    config,
    db: {block: {getBinary}, blockCertification: {hotVerified: false}},
    seenBlockInputCache: {get: () => undefined},
    forkChoice: {getBlockHexDefaultStatus: () => ({blockRoot: toRootHex(root), slot: 1})},
  };
  (chain as unknown as IBeaconChain).getSerializedBlockByRoot = BeaconChain.prototype.getSerializedBlockByRoot;
  const factory: handlers.BoundedReqRespHandlers = () => () =>
    handlers.startServingHandler(budget, (context) =>
      onBeaconBlocksByRoot([root], chain as unknown as IBeaconChain, context)
    );
  const {request, permission} = await incoming();
  const owner = new NativeRequests(config, factory, 32);
  permission.resolve();
  await owner.serve(request);
  expect(request.fail).toHaveBeenCalledExactlyOnceWith(RespStatus.RESOURCE_UNAVAILABLE, expect.any(Uint8Array));
  expect(new TextDecoder().decode(vi.mocked(request.fail).mock.calls[0][1])).toBe(
    "Local serving unavailable: uncertified_block"
  );
  expect(getBinary).not.toHaveBeenCalled();
  expect(request.respond).not.toHaveBeenCalled();
  expect(budget.snapshot().occupancy).toBe(0);
});

it("reports no serving capacity while an earlier adapter holds the shared budget, without a timer of its own", async () => {
  const config = servingConfig();
  const budget = HostServingBudget.forEnvironment(resolveServingPolicy(config, 1, 0));
  vi.spyOn(handlers, "servingBudget").mockReturnValue(budget);
  const previous = budget.acquire();
  vi.useFakeTimers();
  const owner = new NativeRequests(
    config,
    () => () => {
      throw Error("No request available");
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
  vi.spyOn(handlers, "servingBudget").mockReturnValue(budget);
  const active: handlers.ServingHandler[] = [];
  const factory: handlers.BoundedReqRespHandlers = () => () => {
    const handler = handlers.startServingHandler(budget, async function* () {
      yield {data: new Uint8Array(1), boundary: {fork: config.getForkName(0), epoch: 0}};
    });
    active.push(handler);
    return handler;
  };
  const owner = new NativeRequests(config, factory, 32);
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
  vi.spyOn(handlers, "servingBudget").mockReturnValue(budget);
  const inputs = await Promise.all(Array.from({length: 9}, () => incoming()));
  for (let i = 1; i < 8; i++) inputs[i].request = {...inputs[i].request, peerId: inputs[i < 4 ? 0 : 4].request.peerId};
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
  const owner = new NativeRequests(config, factory, 32);
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
  vi.spyOn(handlers, "servingBudget").mockReturnValue(budget);
  const inputs = await Promise.all(Array.from({length: 3}, () => incoming()));
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
  const owner = new NativeRequests(config, factory, 3);
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
