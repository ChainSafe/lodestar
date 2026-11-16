import {afterEach, expect, it, vi} from "vitest";
import {ErrorAborted, FetchError, TimeoutError} from "@lodestar/utils";
import {HttpClient} from "../../../src/utils/client/httpClient.js";
import {RouteDefinitionExtra} from "../../../src/utils/client/request.js";
import {EmptyRequestCodec, EmptyResponseCodec} from "../../../src/utils/codecs.js";
import {Endpoint} from "../../../src/utils/types.js";

type TestEndpoint = Endpoint<"GET", void, Record<never, never>, void, void>;

const definition: RouteDefinitionExtra<TestEndpoint> = {
  url: "/test",
  method: "GET",
  operationId: "retryTest",
  req: EmptyRequestCodec,
  resp: EmptyResponseCodec,
  urlFormatter: () => "/test",
};

afterEach(() => vi.useRealTimers());

it("retries a timed-out request with a fresh signal", async () => {
  vi.useFakeTimers();
  let attempts = 0;
  const signals: AbortSignal[] = [];
  const client = new HttpClient({
    baseUrl: "http://localhost",
    globalInit: {timeoutMs: 100, retries: 1, retryDelay: 0},
    fetch: async (url, init) => {
      const signal = init?.signal;
      if (!signal) throw Error("Missing request signal");
      signals.push(signal);
      attempts++;
      const aborted = () => new FetchError(url, new DOMException("Aborted", "AbortError"));
      if (signal.aborted) throw aborted();
      if (attempts === 1) {
        return new Promise<Response>((_, reject) => {
          signal.addEventListener("abort", () => reject(aborted()), {once: true});
        });
      }
      return new Response(null, {status: 204});
    },
  });

  const outcome = client.request(definition, undefined).then(
    (response) => ({ok: response.ok, error: null}),
    (error: unknown) => ({ok: false, error})
  );
  await vi.runAllTimersAsync();

  expect(await outcome).toEqual({ok: true, error: null});
  expect(attempts).toBe(2);
  expect(signals[0]).not.toBe(signals[1]);
});

it("reports a timeout if every attempt times out", async () => {
  vi.useFakeTimers();
  let attempts = 0;
  const client = new HttpClient({
    baseUrl: "http://localhost",
    globalInit: {timeoutMs: 100, retries: 1, retryDelay: 0},
    fetch: async (url, init) => {
      const signal = init?.signal;
      if (!signal) throw Error("Missing request signal");
      attempts++;
      const aborted = () => new FetchError(url, new DOMException("Aborted", "AbortError"));
      if (signal.aborted) throw aborted();
      return new Promise<Response>((_, reject) => {
        signal.addEventListener("abort", () => reject(aborted()), {once: true});
      });
    },
  });

  const error = client.request(definition, undefined).catch((error: unknown) => error);
  await vi.runAllTimersAsync();

  expect(await error).toBeInstanceOf(TimeoutError);
  expect(attempts).toBe(2);
});

it.each(["global", "local"])("keeps %s caller cancellation from retrying", async (source) => {
  vi.useFakeTimers();
  const controller = new AbortController();
  let attempts = 0;
  const client = new HttpClient({
    baseUrl: "http://localhost",
    globalInit: {timeoutMs: 100, retries: 1, retryDelay: 0, ...(source === "global" && {signal: controller.signal})},
    fetch: async (url, init) => {
      const signal = init?.signal;
      if (!signal) throw Error("Missing request signal");
      attempts++;
      return new Promise<Response>((_, reject) => {
        signal.addEventListener("abort", () => reject(new FetchError(url, new DOMException("Aborted", "AbortError"))), {
          once: true,
        });
      });
    },
  });

  const error = client
    .request(definition, undefined, source === "local" ? {signal: controller.signal} : undefined)
    .catch((error: unknown) => error);
  controller.abort();
  await vi.runAllTimersAsync();

  expect(await error).toBeInstanceOf(ErrorAborted);
  expect(attempts).toBe(1);
});
