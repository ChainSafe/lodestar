import {describe, expect, it, vi} from "vitest";
import {ResponseOutgoing} from "@lodestar/reqresp";
import {defer} from "@lodestar/utils";
import {HostServingBudget} from "../../../../../src/network/reqresp/serving/budget.js";
import {startServingHandler} from "../../../../../src/network/reqresp/serving/handler.js";
import {resolveServingPolicy} from "../../../../../src/network/reqresp/serving/policy.js";
import {servingConfig} from "../../../../utils/network/reqresp/servingCases.js";

const policy = resolveServingPolicy(servingConfig(), {boundedReadVersion: 1}, 1, 0);
function occupancy(budget: HostServingBudget, count: number, retiring: number): void {
  expect(budget.snapshot()).toMatchObject({
    occupancy: count,
    outstandingRetirements: retiring,
    reservedBytes: count * policy.reservationBytes,
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
    const handler = startServingHandler(
      budget,
      (context) => {
        tracked = context.read(() => ancillary.promise);
        return {[Symbol.asyncIterator]: () => ({next: () => next.promise, return: returnFn})};
      },
      clear
    );
    occupancy(budget, 1, 0);
    const pending = handler.next();
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

  it("releases factory throws before an iterator exists", () => {
    const budget = HostServingBudget.forEnvironment(policy);
    expect(() =>
      startServingHandler(budget, () => {
        throw Error("decode");
      })
    ).toThrow("decode");
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
      const handler = startServingHandler(budget, (context) => {
        reads = parts.map((part) => context.read(() => part.promise, 8));
        return (async function* () {
          await Promise.all(reads);
          yield* [];
        })();
      });
      const next = handler.next();
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
