import {describe, expect, it, vi} from "vitest";
import {ResponseOutgoing} from "@lodestar/reqresp";
import {defer} from "@lodestar/utils";
import {HostServingBudget} from "../../../../../src/network/reqresp/serving/budget.js";
import {startServingHandler} from "../../../../../src/network/reqresp/serving/handler.js";
import {resolveServingPolicy} from "../../../../../src/network/reqresp/serving/policy.js";
import {ReqRespMethod} from "../../../../../src/network/reqresp/types.js";
import {servingConfig} from "../../../../utils/network/reqresp/servingCases.js";

const policy = resolveServingPolicy(servingConfig(), {boundedReadVersion: 1}, 1, 0);
function occupancy(budget: HostServingBudget, count: number, retiring: number): void {
  expect(budget.snapshot()).toMatchObject({
    occupancy: count,
    outstandingRetirements: retiring,
  });
}

describe("environment serving retirement", () => {
  it("handles synchronous next and return throws without double release", async () => {
    const budget = HostServingBudget.forEnvironment(policy);
    const returns = vi.fn(() => {
      throw Error("return failed");
    });
    const handler = startServingHandler(budget, () => ({
      [Symbol.asyncIterator]: () => ({
        next: () => {
          throw Error("next failed");
        },
        return: returns,
      }),
    }));
    await expect(handler.next()).rejects.toThrow("next failed");
    await handler.retired;
    await expect(handler.return?.()).rejects.toThrow("return failed");
    handler.cancel();
    expect(returns).toHaveBeenCalledOnce();
    occupancy(budget, 0, 0);
  });

  it("cleans up when the route-clear callback throws", async () => {
    const budget = HostServingBudget.forEnvironment(policy);
    const handler = startServingHandler(
      budget,
      async function* () {},
      () => {
        throw Error("route");
      }
    );
    expect(() => handler.cancel()).toThrow("route");
    await handler.retired;
    occupancy(budget, 0, 0);
  });

  it("retains next, return and started ancillary operations independently across replacement", async () => {
    const budget = HostServingBudget.forEnvironment(policy);
    const next = defer<IteratorResult<ResponseOutgoing>>();
    const returned = defer<IteratorResult<ResponseOutgoing>>();
    const ancillary = defer<void>();
    const clear = vi.fn();
    const returnFn = vi.fn(() => {
      expect(clear).toHaveBeenCalledOnce();
      return returned.promise;
    });
    let tracked: Promise<void> | undefined;
    const started = defer<void>();
    const handler = startServingHandler(
      budget,
      (context) => {
        tracked = context.read(() => ancillary.promise);
        started.resolve();
        return {[Symbol.asyncIterator]: () => ({next: () => next.promise, return: returnFn})};
      },
      clear
    );
    occupancy(budget, 1, 0);
    const pending = handler.next();
    await started.promise;
    handler.cancel();
    handler.cancel();
    occupancy(budget, 1, 1);
    expect(returnFn).toHaveBeenCalledOnce();
    expect(HostServingBudget.forEnvironment(policy)).toBe(budget);
    expect(() => startServingHandler(budget, async function* () {})).toThrow("capacity");
    expect(() => HostServingBudget.forEnvironment({...policy, capacity: 2})).toThrow("outstanding");
    try {
      next.resolve({done: true, value: undefined});
      await pending;
      occupancy(budget, 1, 1);
      returned.resolve({done: true, value: undefined});
      await handler.return?.();
      occupancy(budget, 1, 1);
    } finally {
      next.resolve({done: true, value: undefined});
      returned.resolve({done: true, value: undefined});
      ancillary.resolve();
      await tracked;
      await handler.retired;
    }
    occupancy(budget, 0, 0);
    expect(clear).toHaveBeenCalledOnce();
  });

  it("releases factory throws before an iterator exists", async () => {
    const budget = HostServingBudget.forEnvironment(policy);
    const handler = startServingHandler(budget, () => {
      throw Error("decode");
    });
    await expect(handler.next()).rejects.toThrow("decode");
    await handler.retired;
    occupancy(budget, 0, 0);
  });

  it("finishes naturally and preserves partial responses before rejection", async () => {
    const budget = HostServingBudget.forEnvironment(policy);
    const response: ResponseOutgoing = {
      data: new Uint8Array([1]),
      boundary: {fork: servingConfig().getForkName(0), epoch: 0},
    };
    const handler = startServingHandler(budget, async function* () {
      yield response;
      throw Error("later");
    });
    expect(await handler.next()).toEqual({done: false, value: response});
    occupancy(budget, 1, 0);
    await expect(handler.next()).rejects.toThrow("later");
    await handler.retired;
    occupancy(budget, 0, 0);
    const natural = startServingHandler(budget, async function* () {});
    expect((await natural.next()).done).toBe(true);
    await natural.retired;
    occupancy(budget, 0, 0);
  });

  it("retains a sibling after Promise.all rejects in either order", async () => {
    for (const failed of [0, 1]) {
      const budget = HostServingBudget.forEnvironment(policy);
      const parts = [defer<void>(), defer<void>()];
      let reads: Promise<void>[] = [];
      const started = defer<void>();
      const handler = startServingHandler(budget, (context) => {
        reads = parts.map((part) => context.read(() => part.promise, 8));
        started.resolve();
        return (async function* () {
          await Promise.all(reads);
          yield* [];
        })();
      });
      const next = handler.next();
      await started.promise;
      parts[failed].reject(Error("read"));
      try {
        await expect(next).rejects.toThrow("read");
        occupancy(budget, 1, 1);
      } finally {
        parts[1 - failed].resolve();
        await Promise.allSettled(reads);
        await handler.retired;
      }
      occupancy(budget, 0, 0);
    }
  });
});

it("paused responses retain sources without occupying production permits", async () => {
  const limits = resolveServingPolicy(servingConfig(), {boundedReadVersion: 1}, 32, 0, {maxTasks: 2});
  const budget = HostServingBudget.forEnvironment(limits);
  const response: ResponseOutgoing = {
    data: new Uint8Array([1]),
    boundary: {fork: servingConfig().getForkName(0), epoch: 0},
  };
  const handlers = Array.from({length: 9}, (_, index) =>
    startServingHandler(
      budget,
      async function* () {
        yield response;
      },
      undefined,
      `peer-${Math.floor(index / 4)}`
    )
  );
  try {
    for (const handler of handlers) {
      expect((await handler.next()).done).toBe(false);
      expect(budget.snapshot().working).toBe(0);
    }
    expect(budget.snapshot()).toMatchObject({occupancy: 9, waiting: 0});
    expect(budget.snapshot().reservedBytes).toBeLessThanOrEqual(limits.totalBytes);
  } finally {
    for (const handler of handlers) handler.cancel();
    await Promise.all(handlers.map((handler) => handler.retired));
  }
  occupancy(budget, 0, 0);
});

it("a full retained allowance leaves work capacity for an existing response to retire", async () => {
  const config = servingConfig();
  const basic = resolveServingPolicy(config, {boundedReadVersion: 1}, 3, 0);
  // Room for the states, one maximum production step and the largest retained charge, a block range's
  const rangeRetained = basic.methods[ReqRespMethod.BeaconBlocksByRange]?.retainedBytes ?? 0;
  const limits = resolveServingPolicy(config, {boundedReadVersion: 1}, 3, 0, {
    totalBytes: 3 * basic.stateBytes + basic.workingBytes + rangeRetained,
    maxTasks: 2,
  });
  const budget = HostServingBudget.forEnvironment(limits);
  const handlers = Array.from({length: 3}, (_, index) =>
    startServingHandler(
      budget,
      async function* () {
        yield {data: new Uint8Array([index]), boundary: {fork: config.getForkName(0), epoch: 0}};
      },
      undefined,
      `peer-${index}`
    )
  );
  try {
    await handlers[0].next();
    await handlers[1].next();
    const third = handlers[2].next();
    expect(budget.snapshot()).toMatchObject({waiting: 1, working: 0});
    expect((await handlers[0].next()).done).toBe(true);
    expect((await third).done).toBe(false);
    expect(budget.snapshot().reservedBytes).toBeLessThanOrEqual(limits.totalBytes);
  } finally {
    for (const handler of handlers) handler.cancel();
    await Promise.all(handlers.map((handler) => handler.retired));
  }
});

it("bounded production gives waiting peers a turn and cancellation removes queued work", async () => {
  const limits = resolveServingPolicy(servingConfig(), {boundedReadVersion: 1}, 6, 0, {maxTasks: 2});
  const budget = HostServingBudget.forEnvironment(limits);
  const holds = [defer<void>(), defer<void>()];
  const started = [defer<void>(), defer<void>()];
  const order: string[] = [];
  const active = holds.map((hold, index) =>
    startServingHandler(
      budget,
      async function* () {
        started[index].resolve();
        await hold.promise;
        yield* [];
      },
      undefined,
      "a"
    )
  );
  const make = (peer: string) =>
    startServingHandler(
      budget,
      async function* () {
        order.push(peer);
        yield* [];
      },
      undefined,
      peer
    );
  const nextA = make("a");
  const nextB = make("b");
  const cancelled = make("c");
  const handlers = [...active, nextA, nextB, cancelled];
  const activePulls = active.map((handler) => handler.next());
  await Promise.all(started.map((start) => start.promise));
  const queued = [nextA.next(), nextB.next(), cancelled.next()];
  const results = Promise.allSettled(queued);
  cancelled.cancel();
  try {
    holds[0].resolve();
    const outcomes = await results;
    expect(outcomes.slice(0, 2).every((outcome) => outcome.status === "fulfilled")).toBe(true);
    expect(outcomes[2]).toMatchObject({status: "rejected", reason: {code: "HOST_SERVING_CANCELLED"}});
    expect(order).toEqual(["b", "a"]);
    holds[1].resolve();
    await Promise.all(activePulls);
    await Promise.all(handlers.map((handler) => handler.retired));
    expect(budget.snapshot()).toMatchObject({occupancy: 0, working: 0, waiting: 0, reservedBytes: 0});
  } finally {
    for (const hold of holds) hold.resolve();
    for (const handler of handlers) handler.cancel();
    await Promise.allSettled([...activePulls, ...queued]);
    await Promise.all(handlers.map((handler) => handler.retired));
  }
});

it("cancels retained-memory admission without starting a source operation", async () => {
  const config = servingConfig();
  const basic = resolveServingPolicy(config, {boundedReadVersion: 1}, 2, 0);
  const rangeRetained = basic.methods[ReqRespMethod.BeaconBlocksByRange]?.retainedBytes ?? 0;
  const limits = resolveServingPolicy(config, {boundedReadVersion: 1}, 2, 0, {
    totalBytes: 2 * basic.stateBytes + basic.workingBytes + rangeRetained,
  });
  const budget = HostServingBudget.forEnvironment(limits);
  const factory = vi.fn(async function* () {});
  // Block ranges retain the largest charge, so a second one waits for the first
  const first = startServingHandler(budget, factory, undefined, "", ReqRespMethod.BeaconBlocksByRange);
  const second = startServingHandler(budget, factory, undefined, "", ReqRespMethod.BeaconBlocksByRange);
  try {
    await first.prepare();
    const pending = second.prepare();
    expect(budget.snapshot()).toMatchObject({waiting: 1, working: 0});
    second.cancel();
    await expect(pending).rejects.toMatchObject({code: "HOST_SERVING_CANCELLED"});
    await second.retired;
    expect(factory).not.toHaveBeenCalled();
    expect(budget.snapshot()).toMatchObject({occupancy: 1, waiting: 0, working: 0});
  } finally {
    first.cancel();
    second.cancel();
    await Promise.all([first.retired, second.retired]);
  }
  expect(budget.snapshot().reservedBytes).toBe(0);
});
