import {afterEach, beforeEach, expect, it, vi} from "vitest";
import {ISignatureSet, SignatureSetType} from "@lodestar/state-transition";
import {defer} from "@lodestar/utils";
import {BlsMultiThreadWorkerPool} from "../../../../src/chain/bls/multithread/index.js";
import {BlsWorkReq, BlsWorkResult, WorkResultCode} from "../../../../src/chain/bls/multithread/types.js";
import {QueueErrorCode} from "../../../../src/util/queue/errors.js";
import {getMockedLogger} from "../../../mocks/loggerMock.js";

const worker = vi.hoisted(() => ({
  verify: vi.fn<(requests: BlsWorkReq[]) => Promise<BlsWorkResult>>(),
  terminate: vi.fn<() => Promise<void>>(),
}));
vi.mock("@chainsafe/threads", () => {
  Object.defineProperty(globalThis, "self", {value: undefined, writable: true, configurable: true});
  return {
    Worker: class {
      terminate(): Promise<void> {
        return worker.terminate();
      }
    },
    spawn: async () => ({verifyManySignatureSets: worker.verify}),
  };
});
vi.mock("../../../../src/chain/bls/multithread/poolSize.js", () => ({defaultPoolSize: 3}));

const signature: ISignatureSet = {
  type: SignatureSetType.single,
  pubkey: new Uint8Array(48),
  signature: new Uint8Array(96),
  signingRoot: new Uint8Array(32),
};
let pool: BlsMultiThreadWorkerPool;
let calls: {requests: BlsWorkReq[]; completion: ReturnType<typeof defer<BlsWorkResult>>}[];
let operations: Promise<unknown>[];
let wake: ReturnType<typeof vi.fn<() => void>>;
beforeEach(async () => {
  vi.useFakeTimers();
  calls = [];
  operations = [];
  worker.terminate.mockReset().mockResolvedValue();
  worker.verify.mockImplementation((requests) => {
    const completion = defer<BlsWorkResult>();
    calls.push({requests, completion});
    return completion.promise;
  });
  wake = vi.fn(() => expect(pool.canAcceptWork()).toBe(true));
  pool = new BlsMultiThreadWorkerPool({}, {logger: getMockedLogger(), metrics: null, onCapacity: wake});
  await pool["waitTillInitialized"]();
});
afterEach(async () => {
  await pool.close();
  await Promise.all(operations);
  vi.clearAllTimers();
  vi.useRealTimers();
});
function submit(sets: ISignatureSet[]): Promise<boolean> {
  const promise = pool.verifySignatureSets(sets);
  operations.push(promise.catch((error: unknown) => error));
  return promise;
}

it.each(["success", "failure"] as const)("notifies when a busy worker returns after %s", async (outcome) => {
  const first = submit(Array.from({length: 128}, () => signature));
  void submit(Array.from({length: 128}, () => signature));
  await vi.runAllTimersAsync();
  expect(calls).toHaveLength(2);
  expect(pool.canAcceptWork()).toBe(false);
  expect(wake).not.toHaveBeenCalled();
  const failure = Error("worker failed");
  if (outcome === "failure") calls[0].completion.reject(failure);
  else
    calls[0].completion.resolve({
      workerId: 0,
      batchRetries: 0,
      batchSigsSuccess: 0,
      verificationCalls: [],
      workerStartTime: [0, 0],
      workerEndTime: [0, 0],
      results: calls[0].requests.map(() => ({
        code: WorkResultCode.success,
        result: [true],
      })),
    });
  await vi.runAllTimersAsync();
  if (outcome === "failure") await expect(first).rejects.toBe(failure);
  else await expect(first).resolves.toBe(true);
  expect(wake).toHaveBeenCalledOnce();
});

it("rejects queued and buffered jobs at close and refuses every verification entry point", async () => {
  const pending = [
    pool.verifySignatureSets([signature]),
    pool.verifySignatureSets([signature], {batchable: true}),
    pool.verifySignatureSets([signature], {batchable: true, priority: true}),
  ];
  const aborted = {type: {code: QueueErrorCode.QUEUE_ABORTED}};
  const rejected = pending.map((promise) => expect(promise).rejects.toMatchObject(aborted));
  await pool.close();
  await Promise.all(rejected);
  expect(pool.canAcceptWork()).toBe(false);
  await expect(pool.verifySignatureSets([signature])).rejects.toMatchObject(aborted);
  await expect(pool.verifySignatureSets([signature], {verifyOnMainThread: true})).rejects.toMatchObject(aborted);
  await expect(pool.verifySignatureSetsSameMessage([], new Uint8Array(32))).rejects.toMatchObject(aborted);
  await vi.runAllTimersAsync();
  expect(worker.verify).not.toHaveBeenCalled();
  expect(wake).not.toHaveBeenCalled();
});

it("shares shutdown and retires active jobs when their workers terminate, without reporting capacity", async () => {
  const active = [
    submit(Array.from({length: 128}, () => signature)),
    submit(Array.from({length: 128}, () => signature)),
  ];
  await vi.runAllTimersAsync();
  expect(calls).toHaveLength(2);
  const terminated = [defer<void>(), defer<void>()];
  worker.terminate
    .mockImplementationOnce(() => terminated[0].promise)
    .mockImplementationOnce(() => terminated[1].promise);
  let settled = 0;
  for (const operation of active)
    void operation.catch(() => {
      settled++;
    });
  const closed = pool.close();
  let joined = false;
  void closed.then(() => {
    joined = true;
  });
  expect(pool.close()).toBe(closed);
  expect(pool.canAcceptWork()).toBe(false);
  await Promise.resolve();
  expect(settled).toBe(0);
  terminated[0].resolve();
  await expect(active[0]).rejects.toMatchObject({type: {code: QueueErrorCode.QUEUE_ABORTED}});
  expect(settled).toBe(1);
  expect(joined).toBe(false);
  terminated[1].resolve();
  await closed;
  await expect(active[1]).rejects.toMatchObject({type: {code: QueueErrorCode.QUEUE_ABORTED}});
  expect(settled).toBe(2);
  await vi.runAllTimersAsync();
  expect(worker.terminate).toHaveBeenCalledTimes(2);
  expect(worker.verify).toHaveBeenCalledTimes(2);
  expect(wake).not.toHaveBeenCalled();
});

it("notifies when dispatch drains the queue below its admission threshold", async () => {
  for (let i = 0; i < 512; i++) void submit([signature]);
  expect(pool.canAcceptWork()).toBe(false);
  await vi.runAllTimersAsync();
  expect(calls).toHaveLength(2);
  expect(wake).toHaveBeenCalledOnce();
});

it("notifies when every job assigned to the last idle worker fails preparation", async () => {
  void submit(Array.from({length: 128}, () => signature));
  await vi.runAllTimersAsync();
  const invalid: ISignatureSet = {
    type: SignatureSetType.aggregate,
    indices: [-1],
    signature: new Uint8Array(96),
    signingRoot: new Uint8Array(32),
  };
  void submit([invalid]);
  await vi.runAllTimersAsync();
  expect(calls).toHaveLength(1);
  expect(wake).toHaveBeenCalledOnce();
  expect(pool.canAcceptWork()).toBe(true);
});
