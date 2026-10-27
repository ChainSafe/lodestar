import {afterEach, expect, it, vi} from "vitest";
import {NativeNetwork, NativeResponseChunk} from "@chainsafe/lodestar-z/network";
import {createBeaconConfig} from "@lodestar/config";
import {ForkName} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {defer} from "@lodestar/utils";
import {NativeRequestAdmission} from "../../../../src/network/core/native/requestAdmission.js";
import {outgoingNativeRequest} from "../../../../src/network/core/native/requests.js";
import {ReqRespMethod} from "../../../../src/network/reqresp/types.js";
import {collectMaxResponseTyped} from "../../../../src/network/reqresp/utils/collect.js";
import {downloadByRange} from "../../../../src/sync/utils/downloadByRange.js";
import {getMockedLogger} from "../../../mocks/loggerMock.js";
import {getMockedNetwork} from "../../../mocks/mockedNetwork.js";

afterEach(() => vi.restoreAllMocks());

const protocol = "/eth2/beacon_chain/req/beacon_blocks_by_root/2/ssz_snappy";
const args: Parameters<NativeNetwork["request"]> = ["peer", protocol, new Uint8Array(32)];
const done = {done: true as const, value: undefined};
const chunk: NativeResponseChunk = {
  protocol,
  data: new Uint8Array(1),
  fork: "phase0",
  origin: {connection: {index: 0, generation: 1}, endpoint: null},
};

function full(token = "capacity") {
  return Object.assign(new Error("full"), {
    code: "NetworkRequestRejected",
    reason: "local_capacity",
    capacityToken: token,
  });
}

function stream() {
  return {
    [Symbol.asyncIterator]() {
      return this;
    },
    next: vi.fn<() => Promise<IteratorResult<NativeResponseChunk>>>().mockResolvedValue(done),
    return: vi.fn(async () => done),
    throw: vi.fn(async (error?: unknown) => {
      throw error;
    }),
  };
}

it.each(["synchronous", "asynchronous"])("waits after %s refusal and retries only that request", async (mode) => {
  const ready = defer<void>();
  const rejected = stream();
  rejected.next.mockRejectedValue(full());
  const accepted = stream();
  accepted.next.mockResolvedValueOnce({done: false, value: chunk});
  const request = vi
    .fn<NativeNetwork["request"]>()
    .mockImplementationOnce(() => {
      if (mode === "synchronous") throw full();
      return rejected;
    })
    .mockReturnValue(accepted);
  const waitForRequestCapacity = vi.fn(() => ready.promise);
  const iterator = new NativeRequestAdmission({request, waitForRequestCapacity}, args);
  expect(request).toHaveBeenCalledOnce();
  const pending = iterator.next();
  await vi.waitFor(() => expect(waitForRequestCapacity).toHaveBeenCalledOnce());
  expect(request).toHaveBeenCalledOnce();
  ready.resolve();
  expect(await pending).toEqual({done: false, value: chunk});
  expect(request).toHaveBeenCalledTimes(2);
  expect(request.mock.calls).toEqual([args, args]);
  await iterator.return();
  expect(accepted.return).toHaveBeenCalledOnce();
});

it("uses one deadline across repeated releases and refuses a late retry", async () => {
  const now = vi.spyOn(performance, "now").mockReturnValue(0);
  const request = vi.fn<NativeNetwork["request"]>(() => {
    throw full();
  });
  const waitForRequestCapacity = vi
    .fn<NativeNetwork["waitForRequestCapacity"]>()
    .mockImplementationOnce(async () => {
      now.mockReturnValue(10000);
    })
    .mockImplementationOnce(async () => {
      now.mockReturnValue(60000);
    });
  const iterator = new NativeRequestAdmission({request, waitForRequestCapacity}, args);
  await expect(iterator.next()).rejects.toMatchObject({type: {code: "NATIVE_NETWORK_CAPACITY"}});
  expect(waitForRequestCapacity.mock.calls.map(([, options]) => options.timeoutMs)).toEqual([60000, 50000]);
  expect(request).toHaveBeenCalledTimes(2);
  await expect(iterator.next()).resolves.toEqual(done);
});

it("does not apply the admission deadline to an accepted response", async () => {
  const now = vi.spyOn(performance, "now").mockReturnValue(0);
  const accepted = stream();
  const next = defer<IteratorResult<NativeResponseChunk>>();
  accepted.next.mockReturnValueOnce(next.promise);
  const request = vi.fn(() => accepted);
  const waitForRequestCapacity = vi.fn();
  const iterator = new NativeRequestAdmission({request, waitForRequestCapacity}, args);
  const pending = iterator.next();
  now.mockReturnValue(120000);
  next.resolve({done: false, value: chunk});
  expect(await pending).toEqual({done: false, value: chunk});
  expect(waitForRequestCapacity).not.toHaveBeenCalled();
  await iterator.return();
});

it("ends the iterator when a retry fails for a reason other than capacity", async () => {
  const failure = Object.assign(new Error("disconnected"), {code: "NetworkRequestRejected", reason: "disconnected"});
  const request = vi
    .fn<NativeNetwork["request"]>()
    .mockImplementationOnce(() => {
      throw full();
    })
    .mockImplementationOnce(() => {
      throw failure;
    });
  const waitForRequestCapacity = vi.fn(async () => {});
  const iterator = new NativeRequestAdmission({request, waitForRequestCapacity}, args);
  await expect(iterator.next()).rejects.toBe(failure);
  await expect(iterator.next()).resolves.toEqual(done);
  expect(request).toHaveBeenCalledTimes(2);
  expect(waitForRequestCapacity).toHaveBeenCalledOnce();
});

it.each(["return", "throw"] as const)("%s cancels a waiting pull without another admission attempt", async (method) => {
  const request = vi.fn<NativeNetwork["request"]>(() => {
    throw full();
  });
  const waitForRequestCapacity = vi.fn<NativeNetwork["waitForRequestCapacity"]>(
    (_token, {signal}) =>
      new Promise((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(new Error("cancelled")), {once: true})
      )
  );
  const iterator = new NativeRequestAdmission({request, waitForRequestCapacity}, args);
  const pending = iterator.next().catch((error: unknown) => error);
  const failure = new Error("caller stopped");
  if (method === "return") await expect(iterator.return()).resolves.toEqual(done);
  else await expect(iterator.throw(failure)).rejects.toBe(failure);
  expect(await pending).toEqual(new Error("cancelled"));
  expect(request).toHaveBeenCalledOnce();
  expect(waitForRequestCapacity.mock.calls[0][1].signal.aborted).toBe(true);
  await expect(iterator.next()).resolves.toEqual(done);
});

it("cancels before the first pull without registering a wait", async () => {
  const request = vi.fn<NativeNetwork["request"]>(() => {
    throw full();
  });
  const waitForRequestCapacity = vi.fn();
  const iterator = new NativeRequestAdmission({request, waitForRequestCapacity}, args);
  await iterator.return();
  await expect(iterator.next()).resolves.toEqual(done);
  expect(waitForRequestCapacity).not.toHaveBeenCalled();
  expect(request).toHaveBeenCalledOnce();
});

it("cancels after a wake before the retry runs", async () => {
  const request = vi.fn<NativeNetwork["request"]>(() => {
    throw full();
  });
  const waitForRequestCapacity = vi.fn(async () => {});
  const iterator = new NativeRequestAdmission({request, waitForRequestCapacity}, args);
  const pending = iterator.next().catch((error: unknown) => error);
  await Promise.resolve();
  await iterator.return();
  expect(await pending).toMatchObject({name: "AbortError"});
  expect(request).toHaveBeenCalledOnce();
});

it("cancels an accepted stream while a pull is pending", async () => {
  const next = defer<IteratorResult<NativeResponseChunk>>();
  const accepted = stream();
  accepted.next.mockReturnValueOnce(next.promise);
  accepted.return.mockImplementation(async () => {
    next.reject(new Error("cancelled"));
    return done;
  });
  const iterator = new NativeRequestAdmission({request: () => accepted, waitForRequestCapacity: vi.fn()}, args);
  const pending = iterator.next().catch((error: unknown) => error);
  await iterator.return();
  expect(await pending).toEqual(new Error("cancelled"));
  expect(accepted.return).toHaveBeenCalledOnce();
});

it("rejects overlapping pulls without registering a second wait", async () => {
  const ready = defer<void>();
  const request = vi
    .fn<NativeNetwork["request"]>()
    .mockImplementationOnce(() => {
      throw full();
    })
    .mockReturnValue(stream());
  const waitForRequestCapacity = vi.fn(() => ready.promise);
  const iterator = new NativeRequestAdmission({request, waitForRequestCapacity}, args);
  const first = iterator.next();
  await expect(iterator.next()).rejects.toMatchObject({code: "NetworkRequestBusy"});
  expect(waitForRequestCapacity).toHaveBeenCalledOnce();
  ready.resolve();
  await expect(first).resolves.toEqual(done);
});

it.each(["NetworkClosed", "NetworkRequestCapacityTimeout"])(
  "ends %s locally without reporting or retrying a peer",
  async (code) => {
    const request = vi.fn<NativeNetwork["request"]>(() => {
      throw full();
    });
    const waitForRequestCapacity = vi.fn(async () => {
      throw Object.assign(new Error(code), {code});
    });
    const report = vi.fn();
    const iterator = outgoingNativeRequest(
      {request, waitForRequestCapacity},
      {
        peerId: "peer",
        method: ReqRespMethod.BeaconBlocksByRoot,
        versions: [2],
        requestData: args[2],
      },
      report
    );
    await expect(iterator.next()).rejects.toMatchObject(
      code === "NetworkClosed" ? {code} : {type: {code: "NATIVE_NETWORK_CAPACITY"}}
    );
    expect(request).toHaveBeenCalledOnce();
    expect(report).not.toHaveBeenCalled();
  }
);

it.each([false, true])("never retries a stream failure, received=%s", async (received) => {
  const accepted = stream();
  const failure = received
    ? full()
    : Object.assign(new Error("timeout"), {code: "NetworkRequestFailed", reason: "timeout"});
  if (received) accepted.next.mockResolvedValueOnce({done: false, value: chunk});
  accepted.next.mockRejectedValue(failure);
  const request = vi.fn(() => accepted);
  const waitForRequestCapacity = vi.fn();
  const iterator = new NativeRequestAdmission({request, waitForRequestCapacity}, args);
  if (received) await iterator.next();
  await expect(iterator.next()).rejects.toBe(failure);
  expect(request).toHaveBeenCalledOnce();
  expect(waitForRequestCapacity).not.toHaveBeenCalled();
});

it("allows a range batch's accepted sibling to complete while only the refused request waits", async () => {
  const ready = defer<void>();
  const blocked = defer<void>();
  const blocksDone = defer<void>();
  const block = ssz.gloas.SignedBeaconBlock.defaultValue();
  block.message.slot = 1;
  const report = vi.fn();
  const request = vi.fn<NativeNetwork["request"]>((_peer, id) => {
    if (id.includes("envelopes") && request.mock.calls.filter(([, method]) => method === id).length === 1) throw full();
    return (async function* () {
      if (id.includes("beacon_blocks")) {
        yield {
          protocol: id,
          data: ssz.gloas.SignedBeaconBlock.serialize(block),
          fork: ForkName.gloas,
          origin: {connection: {index: 0, generation: 1}, endpoint: null},
        };
      }
    })();
  });
  const waitForRequestCapacity = vi.fn(() => {
    blocked.resolve();
    return ready.promise;
  });
  const native = {request, waitForRequestCapacity};
  const network = getMockedNetwork();
  network.sendBeaconBlocksByRange = vi.fn(async () => {
    const blocks = await collectMaxResponseTyped(
      outgoingNativeRequest(
        native,
        {
          peerId: "peer",
          method: ReqRespMethod.BeaconBlocksByRange,
          versions: [2],
          requestData: new Uint8Array(24),
        },
        report
      ),
      1,
      () => ssz.gloas.SignedBeaconBlock
    );
    blocksDone.resolve();
    return blocks;
  });
  network.sendExecutionPayloadEnvelopesByRange = vi.fn(async () =>
    collectMaxResponseTyped(
      outgoingNativeRequest(
        native,
        {
          peerId: "peer",
          method: ReqRespMethod.ExecutionPayloadEnvelopesByRange,
          versions: [1],
          requestData: new Uint8Array(16),
        },
        report
      ),
      1,
      () => ssz.gloas.SignedExecutionPayloadEnvelope
    )
  );
  let settled = false;
  const result = downloadByRange({
    config: createBeaconConfig(
      {
        ALTAIR_FORK_EPOCH: 0,
        BELLATRIX_FORK_EPOCH: 0,
        CAPELLA_FORK_EPOCH: 0,
        DENEB_FORK_EPOCH: 0,
        ELECTRA_FORK_EPOCH: 0,
        FULU_FORK_EPOCH: 0,
        GLOAS_FORK_EPOCH: 0,
      },
      new Uint8Array(32)
    ),
    network,
    logger: getMockedLogger(),
    peerIdStr: "peer",
    blocksRequest: {startSlot: 1, count: 1, step: 1},
    envelopesRequest: {startSlot: 1, count: 1},
  }).finally(() => {
    settled = true;
  });
  await blocked.promise;
  await blocksDone.promise;
  expect(settled).toBe(false);
  ready.resolve();
  expect((await result).result.responses.validatedBlocks).toMatchObject([{block}]);
  expect(network.sendBeaconBlocksByRange).toHaveBeenCalledOnce();
  expect(network.sendExecutionPayloadEnvelopesByRange).toHaveBeenCalledOnce();
  expect(request).toHaveBeenCalledTimes(3);
  expect(report).not.toHaveBeenCalled();
});
