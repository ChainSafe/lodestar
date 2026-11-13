import EventEmitter from "node:events";
import {describe, expect, it} from "vitest";
import {sleep} from "@lodestar/utils";
import {
  AsyncIterableBridgeCaller,
  AsyncIterableBridgeHandler,
  AsyncIterableEventBus,
} from "../../../src/util/asyncIterableToEvents.js";

type Args = {count: number; delayMs?: number; failAt?: number};

function createEventBus(): AsyncIterableEventBus<Args, number> {
  const emitter = new EventEmitter();
  return {
    emitRequest: (data) => emitter.emit("request", data),
    emitRequestCancel: (data) => emitter.emit("cancel", data),
    emitResponse: (data) => emitter.emit("response", data),
    onRequest: (cb) => emitter.on("request", cb),
    onRequestCancel: (cb) => emitter.on("cancel", cb),
    onResponse: (cb) => emitter.on("response", cb),
  };
}

describe("util / asyncIterableToEvents", () => {
  function setup() {
    const events = createEventBus();
    const produced: number[] = [];
    let finallyRuns = 0;

    const handler = new AsyncIterableBridgeHandler(events, async function* ({count, delayMs, failAt}: Args) {
      try {
        for (let i = 0; i < count; i++) {
          if (delayMs !== undefined) await sleep(delayMs);
          if (i === failAt) throw Error(`fail at ${i}`);
          produced.push(i);
          yield i;
        }
      } finally {
        finallyRuns++;
      }
    });
    const caller = new AsyncIterableBridgeCaller(events);

    return {events, caller, handler, produced, getFinallyRuns: () => finallyRuns};
  }

  it("delivers all items and completes", async () => {
    const {caller, handler, produced, getFinallyRuns} = setup();

    const items: number[] = [];
    for await (const item of caller.getAsyncIterable({count: 3})) {
      items.push(item);
    }

    expect(items).toEqual([0, 1, 2]);
    expect(produced).toEqual([0, 1, 2]);
    expect(getFinallyRuns()).toBe(1);
    expect(caller.pendingCount).toBe(0);
    expect(handler.iteratingCount).toBe(0);
  });

  it("propagates handler errors", async () => {
    const {caller, handler} = setup();

    const items: number[] = [];
    await expect(async () => {
      for await (const item of caller.getAsyncIterable({count: 3, failAt: 1})) {
        items.push(item);
      }
    }).rejects.toThrow("fail at 1");

    expect(items).toEqual([0]);
    expect(caller.pendingCount).toBe(0);
    expect(handler.iteratingCount).toBe(0);
  });

  it("stops the handler iterator when the consumer returns early", async () => {
    const {caller, handler, produced, getFinallyRuns} = setup();

    for await (const item of caller.getAsyncIterable({count: 1000, delayMs: 1})) {
      expect(item).toBe(0);
      break;
    }
    expect(caller.pendingCount).toBe(0);

    await expect.poll(() => getFinallyRuns()).toBe(1);
    // return() is queued behind the in-flight next(), so at most one extra item is produced
    expect(produced.length).toBeLessThanOrEqual(2);
    expect(handler.iteratingCount).toBe(0);
  });

  it("ignores cancel events for unknown request ids", () => {
    const {events, handler} = setup();

    expect(() => events.emitRequestCancel({id: 123})).not.toThrow();
    expect(handler.iteratingCount).toBe(0);
  });
});
