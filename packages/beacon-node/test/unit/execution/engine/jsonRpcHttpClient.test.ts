import {afterEach, describe, expect, it, vi} from "vitest";
import {ErrorAborted, TimeoutError} from "@lodestar/utils";
import {JsonRpcHttpClient} from "../../../../src/execution/engine/jsonRpcHttpClient.js";

describe("JsonRpcHttpClient request cancellation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("does not send an already cancelled request", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({result: "ok"}));
    vi.stubGlobal("fetch", fetch);
    const client = new JsonRpcHttpClient(["http://localhost:8551"]);

    await expect(client.fetch({method: "test", params: []}, {signal: AbortSignal.abort()})).rejects.toThrow(
      ErrorAborted
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("cancels one request without cancelling another", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementationOnce(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        })
    );
    fetch.mockResolvedValueOnce(Response.json({result: "second"}));
    vi.stubGlobal("fetch", fetch);
    const client = new JsonRpcHttpClient(["http://localhost:8551"]);
    const controller = new AbortController();
    const first = expect(client.fetch({method: "first", params: []}, {signal: controller.signal})).rejects.toThrow(
      ErrorAborted
    );

    const second = client.fetch({method: "second", params: []});
    controller.abort();
    await first;
    await expect(second).resolves.toBe("second");
  });

  it("still observes client shutdown when a request signal is supplied", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({result: "ok"}));
    vi.stubGlobal("fetch", fetch);
    const client = new JsonRpcHttpClient(["http://localhost:8551"], {signal: AbortSignal.abort()});

    await expect(client.fetch({method: "test", params: []}, {signal: new AbortController().signal})).rejects.toThrow(
      ErrorAborted
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("cancels a retry delay without another request or a leaked timer", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockRejectedValue(new Error("connection failed"));
    vi.stubGlobal("fetch", fetch);
    const client = new JsonRpcHttpClient(["http://localhost:8551"]);
    const controller = new AbortController();
    const result = expect(
      client.fetchWithRetries({method: "test", params: []}, {signal: controller.signal, retries: 2, retryDelay: 1000})
    ).rejects.toThrow(ErrorAborted);
    await vi.advanceTimersByTimeAsync(0);

    controller.abort();
    await result;
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retains timeout errors and cleans up the request timer", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof globalThis.fetch>().mockImplementation(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
          })
      )
    );
    const client = new JsonRpcHttpClient(["http://localhost:8551"]);
    const result = expect(
      client.fetch({method: "test", params: []}, {signal: new AbortController().signal, timeout: 10})
    ).rejects.toThrow(TimeoutError);

    await vi.advanceTimersByTimeAsync(10);
    await result;
    expect(vi.getTimerCount()).toBe(0);
  });
});
