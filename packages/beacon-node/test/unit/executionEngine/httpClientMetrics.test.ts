import {afterEach, describe, expect, it, vi} from "vitest";
import {ClientCode} from "../../../src/execution/engine/interface.js";
import {JsonRpcHttpClient, JsonRpcHttpClientMetrics} from "../../../src/execution/engine/jsonRpcHttpClient.js";
import {EngineRestHttpClient} from "../../../src/execution/engine/restHttpClient.js";
import {RestEngineTransport} from "../../../src/execution/engine/restTransport.js";
import {BlobsV2Response} from "../../../src/execution/engine/sszTypes.js";

describe("Engine HTTP response timing", () => {
  const routeId = "getClientVersion";
  const body = '{"jsonrpc":"2.0","id":1,"result":[]}';

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function mockHistogram() {
    const observe = vi.fn();
    return {
      startTimer: vi.fn((labels?: {routeId?: string; encoding?: "json" | "ssz"}) => {
        const start = Date.now();
        return () => {
          const duration = (Date.now() - start) / 1000;
          observe(labels, duration);
          return duration;
        };
      }),
      observe,
      reset: vi.fn(),
    };
  }

  function setup(transport: "json-rpc" | "rest", status = 200, bodyError?: Error, bodyText = body) {
    vi.useFakeTimers({now: 0});
    const streamTime = mockHistogram();
    const responseParseTime = mockHistogram();
    const gauge = {inc: vi.fn(), dec: vi.fn(), set: vi.fn(), reset: vi.fn()};
    const metrics: JsonRpcHttpClientMetrics = {
      streamTime,
      responseParseTime,
      requestTime: {startTimer: vi.fn(() => () => 0), observe: vi.fn(), reset: vi.fn()},
      requestErrors: gauge,
      requestUsedFallbackUrl: gauge,
      activeRequests: gauge,
      configUrlsCount: gauge,
      retryCount: gauge,
      requestBytes: {inc: vi.fn()},
      responseBytes: {inc: vi.fn()},
    };
    const response = new Response(status === 204 ? null : bodyText, {
      status,
      headers: {"content-type": "application/json"},
    });
    function readBody(): void {
      vi.advanceTimersByTime(200);
      if (bodyError) throw bodyError;
    }
    vi.spyOn(response, "text").mockImplementation(async () => {
      readBody();
      return bodyText;
    });
    vi.spyOn(response, "arrayBuffer").mockImplementation(async () => {
      readBody();
      return new TextEncoder().encode(status === 204 ? "" : bodyText).buffer;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        vi.advanceTimersByTime(100);
        return response;
      })
    );
    const request =
      transport === "json-rpc"
        ? () =>
            new JsonRpcHttpClient(["http://localhost:8551"], {metrics}).fetch({method: "test", params: []}, {routeId})
        : () =>
            new EngineRestHttpClient(["http://localhost:8551"], {metrics}).requestWithRetries(
              {method: "GET", path: "/identity", responseType: "json"},
              {routeId}
            );
    return {request, observe: streamTime.observe, streamTime, responseParseTime, metrics, response};
  }

  it.each(["json-rpc", "rest"] as const)("records only body consumption for %s", async (transport) => {
    const {request, observe, streamTime} = setup(transport);
    await request();
    expect(streamTime.startTimer).toHaveBeenCalledExactlyOnceWith({routeId});
    expect(observe).toHaveBeenCalledExactlyOnceWith({routeId}, 0.2);
  });

  it.each(["json-rpc", "rest"] as const)("records a failed body read for %s", async (transport) => {
    const {request, observe, responseParseTime} = setup(transport, 200, new Error("body failed"));
    await expect(request()).rejects.toThrow("body failed");
    expect(observe).toHaveBeenCalledExactlyOnceWith({routeId}, 0.2);
    expect(responseParseTime.observe).not.toHaveBeenCalled();
  });

  it.each(["json-rpc", "rest"] as const)("records the body of an HTTP error for %s", async (transport) => {
    const {request, observe, responseParseTime} = setup(transport, 503);
    await expect(request()).rejects.toThrow();
    expect(observe).toHaveBeenCalledExactlyOnceWith({routeId}, 0.2);
    expect(responseParseTime.observe).not.toHaveBeenCalled();
  });

  it("excludes JSON parsing from the body timer", async () => {
    const {request, observe, responseParseTime} = setup("json-rpc");
    const parse = JSON.parse;
    const parseSpy = vi.spyOn(JSON, "parse").mockImplementation((text: string) => {
      vi.advanceTimersByTime(500);
      return parse(text);
    });
    await expect(request()).resolves.toEqual([]);
    expect(parseSpy).toHaveBeenCalledExactlyOnceWith(body);
    expect(observe).toHaveBeenCalledExactlyOnceWith({routeId}, 0.2);
    expect(responseParseTime.observe).toHaveBeenCalledExactlyOnceWith({routeId, encoding: "json"}, 0.5);
  });

  it("records body time even when JSON parsing fails", async () => {
    const {request, observe, responseParseTime} = setup("json-rpc", 200, undefined, "invalid JSON");
    const parse = JSON.parse;
    vi.spyOn(JSON, "parse").mockImplementation((text: string) => {
      vi.advanceTimersByTime(500);
      return parse(text);
    });
    await expect(request()).rejects.toThrow("Error parsing JSON");
    expect(observe).toHaveBeenCalledExactlyOnceWith({routeId}, 0.2);
    expect(responseParseTime.observe).toHaveBeenCalledExactlyOnceWith({routeId, encoding: "json"}, 0.5);
  });

  it.each([true, false])("records SSZ parser time separately, valid=%s", async (valid) => {
    const {metrics, response, observe, responseParseTime} = setup("rest");
    const bytes = valid ? BlobsV2Response.serialize({entries: []}) : new Uint8Array([0]);
    response.headers.set("content-type", "application/octet-stream");
    vi.mocked(response.arrayBuffer).mockImplementation(async () => {
      vi.advanceTimersByTime(200);
      return new Uint8Array(bytes).buffer;
    });
    const deserialize = BlobsV2Response.deserialize.bind(BlobsV2Response);
    const deserializeSpy = vi.spyOn(BlobsV2Response, "deserialize").mockImplementation((data, opts) => {
      vi.advanceTimersByTime(500);
      return deserialize(data, opts);
    });
    const transport = new RestEngineTransport(new EngineRestHttpClient(["http://localhost:8551"], {metrics}), metrics);
    const result = transport.getBlobsV2([]);
    if (valid) await expect(result).resolves.toEqual([]);
    else await expect(result).rejects.toThrow("Invalid SSZ");
    expect(deserializeSpy).toHaveBeenCalledExactlyOnceWith(bytes, {reuseBytes: true});
    expect(observe).toHaveBeenCalledExactlyOnceWith({routeId: "getBlobsV2"}, 0.2);
    expect(responseParseTime.observe).toHaveBeenCalledExactlyOnceWith({routeId: "getBlobsV2", encoding: "ssz"}, 0.5);
  });

  it.each([true, false])("records REST JSON parser time separately, valid=%s", async (valid) => {
    const {metrics, observe, responseParseTime} = setup("rest", 200, undefined, valid ? "[]" : "invalid JSON");
    const parse = JSON.parse;
    vi.spyOn(JSON, "parse").mockImplementation((text: string) => {
      vi.advanceTimersByTime(500);
      return parse(text);
    });
    const transport = new RestEngineTransport(new EngineRestHttpClient(["http://localhost:8551"], {metrics}), metrics);
    const result = transport.getClientVersion({code: ClientCode.XX, name: "test", version: "1", commit: "00"});
    if (valid) await expect(result).resolves.toEqual([]);
    else await expect(result).rejects.toThrow("Invalid JSON");
    expect(observe).toHaveBeenCalledExactlyOnceWith({routeId}, 0.2);
    expect(responseParseTime.observe).toHaveBeenCalledExactlyOnceWith({routeId, encoding: "json"}, 0.5);
  });

  it("does not record parser time for an empty REST response", async () => {
    const {metrics, observe, responseParseTime} = setup("rest", 204);
    const transport = new RestEngineTransport(new EngineRestHttpClient(["http://localhost:8551"], {metrics}), metrics);
    await expect(transport.getBlobsV2([])).resolves.toBeNull();
    expect(observe).toHaveBeenCalledExactlyOnceWith({routeId: "getBlobsV2"}, 0.2);
    expect(responseParseTime.observe).not.toHaveBeenCalled();
  });
});
