import EventEmitter from "node:events";
import {describe, expect, it} from "vitest";
import {sleep} from "@lodestar/utils";
import {
  AsyncIterableBridgeCaller,
  AsyncIterableBridgeHandler,
  AsyncIterableEventBus,
  RESP_BRIDGE_WINDOW,
} from "../../../src/util/asyncIterableToEvents.js";

type Args = {count: number; delayMs?: number; failAt?: number};

function createEventBus(): AsyncIterableEventBus<Args, number> {
  const emitter = new EventEmitter();
  return {
    emitRequest: (data) => emitter.emit("request", data),
    emitRequestCancel: (data) => emitter.emit("cancel", data),
    emitResponse: (data) => emitter.emit("response", data),
    emitResponsePull: (data) => emitter.emit("pull", data),
    onRequest: (cb) => emitter.on("request", cb),
    onRequestCancel: (cb) => emitter.on("cancel", cb),
    onResponse: (cb) => emitter.on("response", cb),
    onResponsePull: (cb) => emitter.on("pull", cb),
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

  it("slow consumer: credit window bounds how far the handler runs ahead", async () => {
    const {caller, handler, produced} = setup();

    const it = caller.getAsyncIterable({count: 64})[Symbol.asyncIterator]();
    const first = await it.next();
    expect(first).toEqual({value: 0, done: false});

    // Let the handler run to its blocking point, then stop pulling
    await sleep(20);

    expect(produced.length).toBe(RESP_BRIDGE_WINDOW + 1);
    expect(produced.length).toBeLessThan(64);
    expect(handler.iteratingCount).toBe(1);

    await it.return?.();
    await sleep(20);
    expect(handler.iteratingCount).toBe(0);
  });

  it("fast consumer: all items stream through in order", async () => {
    const {caller, handler, produced, getFinallyRuns} = setup();

    const items: number[] = [];
    for await (const item of caller.getAsyncIterable({count: 64})) {
      items.push(item);
    }

    const expected = Array.from({length: 64}, (_, i) => i);
    expect(items).toEqual(expected);
    expect(produced).toEqual(expected);
    expect(getFinallyRuns()).toBe(1);
    expect(caller.pendingCount).toBe(0);
    expect(handler.iteratingCount).toBe(0);
  });

  it("cancel while the handler is blocked on credit stops it without deadlock", async () => {
    const {caller, handler, produced, getFinallyRuns} = setup();

    const it = caller.getAsyncIterable({count: 1000})[Symbol.asyncIterator]();
    await it.next();

    // Handler fills the window then parks waiting for credit
    await sleep(20);
    expect(produced.length).toBe(RESP_BRIDGE_WINDOW + 1);
    expect(handler.iteratingCount).toBe(1);

    await it.return?.();
    await sleep(20);

    expect(handler.iteratingCount).toBe(0);
    expect(getFinallyRuns()).toBe(1);
    expect(caller.pendingCount).toBe(0);
  });
});
