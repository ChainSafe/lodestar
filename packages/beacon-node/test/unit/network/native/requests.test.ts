import {generateKeyPair} from "@libp2p/crypto/keys";
import {peerIdFromPublicKey} from "@libp2p/peer-id";
import {afterEach, expect, it, vi} from "vitest";
import {NativeIncomingRequest} from "@chainsafe/lodestar-z/network";
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
  const owner = new NativeRequests({takeIncomingRequest}, config, factory, 32);
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
  const owner = new NativeRequests({takeIncomingRequest}, config, factory, 32);
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
