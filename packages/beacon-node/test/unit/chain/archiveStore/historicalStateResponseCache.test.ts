import {describe, expect, it, vi} from "vitest";
import {defer} from "@lodestar/utils";
import {HistoricalStateResponseCache} from "../../../../src/chain/archiveStore/historicalState/responseCache.js";

describe("HistoricalStateResponseCache", () => {
  it("coalesces reads of the same slot and isolates returned buffers", async () => {
    const pending = defer<Uint8Array>();
    const load = vi.fn().mockReturnValue(pending.promise);
    const cache = new HistoricalStateResponseCache(load, new AbortController().signal);
    const a = cache.get(57);
    const b = cache.get(57);
    pending.resolve(Uint8Array.of(1, 2));
    const first = await a;
    const second = await b;
    first[0] = 99;
    expect(second).toEqual(Uint8Array.of(1, 2));
    expect(await cache.get(57)).toEqual(Uint8Array.of(1, 2));
    expect(load).toHaveBeenCalledExactlyOnceWith(57);
  });

  it("retains only the most recently requested slot", async () => {
    const load = vi.fn(async (slot: number) => Uint8Array.of(slot));
    const cache = new HistoricalStateResponseCache(load, new AbortController().signal);
    expect(await cache.get(57)).toEqual(Uint8Array.of(57));
    expect(await cache.get(58)).toEqual(Uint8Array.of(58));
    expect(await cache.get(57)).toEqual(Uint8Array.of(57));
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("owns the retained bytes even if the source or a returned buffer changes", async () => {
    const source = Uint8Array.of(1, 2);
    const load = vi.fn().mockResolvedValue(source);
    const cache = new HistoricalStateResponseCache(load, new AbortController().signal);
    const first = await cache.get(57);
    source.fill(99);
    structuredClone(first, {transfer: [first.buffer]});
    expect(first).toHaveLength(0);
    expect(await cache.get(57)).toEqual(Uint8Array.of(1, 2));
    expect(load).toHaveBeenCalledOnce();
  });

  it("does not retain an oversized response", async () => {
    const load = vi.fn().mockResolvedValue(Uint8Array.of(1, 2, 3));
    const cache = new HistoricalStateResponseCache(load, new AbortController().signal, 2);
    expect(await cache.get(57)).toHaveLength(3);
    expect(await cache.get(57)).toHaveLength(3);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("retries after a failed reconstruction", async () => {
    const error = Error("history unavailable");
    const load = vi.fn().mockRejectedValueOnce(error).mockResolvedValue(Uint8Array.of(1));
    const cache = new HistoricalStateResponseCache(load, new AbortController().signal);
    await expect(cache.get(57)).rejects.toBe(error);
    expect(await cache.get(57)).toEqual(Uint8Array.of(1));
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("does not evict a newer request when an older reconstruction fails", async () => {
    const pending = defer<Uint8Array>();
    const load = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(Uint8Array.of(2));
    const cache = new HistoricalStateResponseCache(load, new AbortController().signal);
    const first = expect(cache.get(57)).rejects.toThrow("old request");
    expect(await cache.get(58)).toEqual(Uint8Array.of(2));
    pending.reject(Error("old request"));
    await first;
    expect(await cache.get(58)).toEqual(Uint8Array.of(2));
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("does not return a late response or start work after shutdown", async () => {
    const pending = defer<Uint8Array>();
    const load = vi.fn().mockReturnValue(pending.promise);
    const controller = new AbortController();
    const cache = new HistoricalStateResponseCache(load, controller.signal);
    const first = expect(cache.get(57)).rejects.toThrow();
    await vi.waitFor(() => expect(load).toHaveBeenCalledOnce());
    controller.abort();
    pending.resolve(Uint8Array.of(1));
    await first;
    await expect(cache.get(57)).rejects.toThrow();
    expect(load).toHaveBeenCalledOnce();
  });

  it("does not start a deferred load if shutdown arrives first", async () => {
    const load = vi.fn().mockResolvedValue(Uint8Array.of(1));
    const controller = new AbortController();
    const cache = new HistoricalStateResponseCache(load, controller.signal);
    const pending = expect(cache.get(57)).rejects.toThrow();
    controller.abort();
    await pending;
    expect(load).not.toHaveBeenCalled();
  });
});
