import {afterEach, expect, it, vi} from "vitest";
import {NativeNetwork, NativeResponseChunk} from "@chainsafe/lodestar-z/network";
import {defer} from "@lodestar/utils";
import {NativeRequestAdmission} from "../../../../src/network/core/native/requestAdmission.js";
import {outgoingNativeRequest} from "../../../../src/network/core/native/requests.js";
import {ReqRespMethod} from "../../../../src/network/reqresp/types.js";

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

it("allows a sibling request to the same peer to finish while one waits for admission", async () => {
  const ready = defer<void>();
  const siblingProtocol = "/eth2/beacon_chain/req/execution_payload_envelopes_by_root/1/ssz_snappy";
  const request = vi
    .fn<NativeNetwork["request"]>()
    .mockImplementationOnce(() => {
      throw full();
    })
    .mockImplementation(() => stream());
  const network = {request, waitForRequestCapacity: vi.fn(() => ready.promise)};
  const waiting = new NativeRequestAdmission(network, args);
  const other = new NativeRequestAdmission(network, [args[0], siblingProtocol, args[2]]);
  const finished = vi.fn();
  const pending = waiting.next().then(finished);
  await expect(other.next()).resolves.toEqual(done);
  expect(finished).not.toHaveBeenCalled();
  ready.resolve();
  await pending;
  expect(request.mock.calls.map(([, method]) => method)).toEqual([protocol, siblingProtocol, protocol]);
});
