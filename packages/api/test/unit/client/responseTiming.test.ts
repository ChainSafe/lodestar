import {afterEach, describe, expect, it, vi} from "vitest";
import {Metrics} from "../../../src/utils/client/metrics.js";
import {RouteDefinitionExtra} from "../../../src/utils/client/request.js";
import {ApiResponse} from "../../../src/utils/client/response.js";
import {MediaType} from "../../../src/utils/headers.js";
import {Endpoint} from "../../../src/utils/types.js";

describe("ApiResponse timing", () => {
  const routeId = "testRoute";
  const deserialize = vi.fn((data: Uint8Array) => data.length);
  const definition = {
    operationId: routeId,
    resp: {
      data: {deserialize, fromJson: (data: unknown) => data},
      meta: {fromJson: () => ({}), fromHeaders: () => ({})},
    },
  } as unknown as RouteDefinitionExtra<Endpoint>;

  afterEach(() => {
    vi.restoreAllMocks();
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

  function setup(contentType: MediaType, body: string | Uint8Array, opts?: {status?: number; bodyError?: Error}) {
    vi.useFakeTimers({now: 0});
    const streamTime = mockHistogram();
    const responseParseTime = mockHistogram();
    const metrics = {streamTime, responseParseTime} as unknown as Metrics;
    const res = new ApiResponse(
      definition,
      typeof body === "string" ? body : new Uint8Array(body),
      {status: opts?.status ?? 200, headers: {"content-type": contentType}},
      metrics
    );
    function readBody(): void {
      vi.advanceTimersByTime(200);
      if (opts?.bodyError) throw opts.bodyError;
    }
    const text = res.text.bind(res);
    const arrayBuffer = res.arrayBuffer.bind(res);
    vi.spyOn(res, "text").mockImplementation(async () => {
      readBody();
      return text();
    });
    vi.spyOn(res, "arrayBuffer").mockImplementation(async () => {
      readBody();
      return arrayBuffer();
    });
    return {res, streamTime, responseParseTime};
  }

  function slowJsonParse(): void {
    const parse = JSON.parse;
    vi.spyOn(JSON, "parse").mockImplementation((text: string) => {
      vi.advanceTimersByTime(500);
      return parse(text);
    });
  }

  it("records JSON body consumption and parsing separately", async () => {
    const {res, streamTime, responseParseTime} = setup(MediaType.json, '{"data":1}');
    slowJsonParse();

    await expect(res.rawBody()).resolves.toEqual({type: "json", value: {data: 1}});
    expect(streamTime.observe).toHaveBeenCalledExactlyOnceWith({routeId}, 0.2);
    expect(responseParseTime.observe).toHaveBeenCalledExactlyOnceWith({routeId, encoding: "json"}, 0.5);
  });

  it("records parse time when JSON parsing fails", async () => {
    const {res, streamTime, responseParseTime} = setup(MediaType.json, "invalid JSON");
    slowJsonParse();

    await expect(res.rawBody()).rejects.toThrow(SyntaxError);
    expect(streamTime.observe).toHaveBeenCalledExactlyOnceWith({routeId}, 0.2);
    expect(responseParseTime.observe).toHaveBeenCalledExactlyOnceWith({routeId, encoding: "json"}, 0.5);
  });

  it("records SSZ deserialization separately from body consumption", async () => {
    const {res, streamTime, responseParseTime} = setup(MediaType.ssz, new Uint8Array([1, 2, 3]));
    deserialize.mockImplementationOnce((data: Uint8Array) => {
      vi.advanceTimersByTime(500);
      return data.length;
    });

    await res.rawBody();
    expect(streamTime.observe).toHaveBeenCalledExactlyOnceWith({routeId}, 0.2);
    expect(responseParseTime.observe).not.toHaveBeenCalled();

    expect(res.value()).toBe(3);
    expect(responseParseTime.observe).toHaveBeenCalledExactlyOnceWith({routeId, encoding: "ssz"}, 0.5);
  });

  it("records parse time when SSZ deserialization fails", async () => {
    const {res, responseParseTime} = setup(MediaType.ssz, new Uint8Array([1]));
    deserialize.mockImplementationOnce(() => {
      vi.advanceTimersByTime(500);
      throw Error("invalid SSZ");
    });

    await res.rawBody();
    expect(() => res.value()).toThrow("invalid SSZ");
    expect(responseParseTime.observe).toHaveBeenCalledExactlyOnceWith({routeId, encoding: "ssz"}, 0.5);
  });

  it("records a failed body read", async () => {
    const {res, streamTime, responseParseTime} = setup(MediaType.json, "{}", {bodyError: new Error("body failed")});

    await expect(res.rawBody()).rejects.toThrow("body failed");
    expect(streamTime.observe).toHaveBeenCalledExactlyOnceWith({routeId}, 0.2);
    expect(responseParseTime.observe).not.toHaveBeenCalled();
  });

  it("records the body of an HTTP error", async () => {
    const {res, streamTime, responseParseTime} = setup(MediaType.json, '{"message":"bad"}', {status: 400});

    await expect(res.errorBody()).resolves.toBe('{"message":"bad"}');
    expect(streamTime.observe).toHaveBeenCalledExactlyOnceWith({routeId}, 0.2);
    expect(responseParseTime.observe).not.toHaveBeenCalled();
  });
});
