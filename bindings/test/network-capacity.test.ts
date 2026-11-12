import {afterEach, expect, test, vi} from "vitest";
import {PublicationCapacityWaiters, RequestCapacityWaiters} from "../src/network-capacity.js";

afterEach(() => vi.useRealTimers());

const families = [
  {
    create: (watch: (token: string) => boolean) => new RequestCapacityWaiters({requestCapacityWatch: watch}),
    prefix: "Request",
    timeoutMs: 120000,
  },
  {
    create: (watch: (token: string) => boolean) => new PublicationCapacityWaiters({publicationCapacityWatch: watch}),
    prefix: "Publication",
    timeoutMs: 172800000,
  },
];

test.each(families)(
  "$prefix waits honor long caller deadlines without extending them on notification",
  async ({prefix, timeoutMs, create}) => {
    vi.useFakeTimers();
    const waits = create(() => false);
    const finished = vi.fn();
    const pending = waits.wait("capacity", {signal: new AbortController().signal, timeoutMs}).catch((error) => {
      finished();
      return error.code;
    });
    await vi.advanceTimersByTimeAsync(timeoutMs - 1);
    waits.changed();
    expect(finished).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toBe(`Network${prefix}CapacityTimeout`);
    expect(vi.getTimerCount()).toBe(0);
    waits.close();
  }
);

test.each(families)(
  "$prefix waits validate timer representation without native policy limits",
  async ({prefix, create}) => {
    vi.useFakeTimers();
    const watch = vi.fn(() => true);
    const waits = create(watch);
    const signal = new AbortController().signal;
    for (const timeoutMs of [0, 2 ** 31]) {
      await expect(waits.wait("capacity", {signal, timeoutMs})).rejects.toMatchObject({
        code: `Invalid${prefix}CapacityTimeout`,
      });
    }
    expect(watch).not.toHaveBeenCalled();
    await waits.wait("capacity", {signal, timeoutMs: 2 ** 31 - 1});
    expect(watch).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    waits.close();
  }
);

test.each(families)(
  "$prefix waits allow caller concurrency and release cancelled or closed waits",
  async ({prefix, create}) => {
    vi.useFakeTimers();
    const waits = create(() => false);
    const controllers = Array.from({length: 300}, () => new AbortController());
    const pending = controllers.map((controller) =>
      waits.wait("slots", {signal: controller.signal, timeoutMs: 1000}).catch((error) => error.code)
    );
    controllers[0].abort();
    expect(await pending[0]).toBe(`Network${prefix}CapacityCancelled`);
    expect(vi.getTimerCount()).toBe(299);
    waits.close();
    expect(await Promise.all(pending.slice(1))).toEqual(Array(299).fill("NetworkClosed"));
    expect(vi.getTimerCount()).toBe(0);
    await expect(waits.wait("slots", {signal: controllers[1].signal, timeoutMs: 1000})).rejects.toMatchObject({
      code: "NetworkClosed",
    });
  }
);

test.each(families)(
  "$prefix waits follow their own resource, including releases before registration",
  async ({create}) => {
    const revisions = {bytes: 0, requests: 0};
    const waits = create((token: string) => revisions[token as keyof typeof revisions] !== 0);
    const controller = new AbortController();
    const finished = vi.fn();
    const pending = waits.wait("requests", {signal: controller.signal, timeoutMs: 1000}).then(finished);
    revisions.bytes++;
    waits.changed();
    await Promise.resolve();
    expect(finished).not.toHaveBeenCalled();
    revisions.requests++;
    waits.changed();
    await pending;
    expect(finished).toHaveBeenCalledOnce();
    await waits.wait("bytes", {signal: controller.signal, timeoutMs: 1000});
    waits.close();
  }
);
