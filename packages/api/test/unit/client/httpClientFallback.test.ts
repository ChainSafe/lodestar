import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {HttpClient, RouteDefinitionExtra, fetch} from "../../../src/utils/client/index.js";
import {AnyEndpoint, EmptyRequestCodec, EmptyResponseCodec} from "../../../src/utils/codecs.js";
import {compileRouteUrlFormatter} from "../../../src/utils/urlFormat.js";

describe("httpClient fallback", () => {
  const url = "/test-route";
  const testDefinition: RouteDefinitionExtra<AnyEndpoint> = {
    url,
    method: "GET",
    req: EmptyRequestCodec,
    resp: EmptyResponseCodec,
    operationId: "testRoute",
    urlFormatter: compileRouteUrlFormatter(url),
  };
  const DEBUG_LOGS = Boolean(process.env.DEBUG);

  // Using fetchSub instead of actually setting up servers because there are some strange
  // race conditions, where the server stub doesn't count the call in time before the test is over.
  const fetchStub = vi.fn<(...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>>();

  let httpClient: HttpClient;

  const serverCount = 3;
  const baseUrls: string[] = [];
  for (let i = 0; i < serverCount; i++) {
    baseUrls.push(`http://127.0.0.1:${18000 + i}`);
  }

  const serverErrors = new Map<number, boolean>();

  // With baseURLs above find the server index associated with that URL
  function getServerIndex(url: URL | string): number {
    const i = baseUrls.findIndex((baseUrl) => url.toString().startsWith(baseUrl));
    if (i < 0) {
      throw Error(`fetch called with unknown url ${url.toString()}`);
    }
    return i;
  }

  // Create fresh HttpClient with new internal state
  beforeEach(() => {
    httpClient = new HttpClient({
      baseUrl: "",
      urls: baseUrls.map((baseUrl) => ({baseUrl})),
      fetch: fetchStub,
    });

    fetchStub.mockImplementation(async (url) => {
      // Simulate network delay
      await new Promise((r) => setTimeout(r, 10));
      const i = getServerIndex(url);
      if (serverErrors.get(i)) {
        if (i === 1) {
          // Simulate one of the servers returning a HTTP error
          // which is handled separately from network errors
          // but the fallback logic should be the same
          return new Response(null, {status: 500});
        }

        throw Error(`test_error_server_${i}`);
      }

      return new Response(null, {status: 200});
    });
  });

  afterEach(() => {
    serverErrors.clear();
  });

  // Compares the call count of all server on a request, prints the diff as "1,1,0" == "1,0,0"
  function assertServerCallCount(step: number, expectedCallCounts: number[]): void {
    const callCounts: number[] = [];
    for (let i = 0; i < serverCount; i++) callCounts[i] = 0;
    for (const call of fetchStub.mock.calls) {
      callCounts[getServerIndex(call[0])]++;
    }

    expect(callCounts.join(",")).toBe(expectedCallCounts.join(","));

    fetchStub.mockClear();

    if (DEBUG_LOGS) console.log("completed assertions step", step);
  }

  async function requestTestRoute(): Promise<void> {
    await httpClient.request(testDefinition, {}, {});
  }

  it("Should only call server 0", async () => {
    await requestTestRoute();
    assertServerCallCount(0, [1, 0, 0]);
  });

  it("server 0 throws, so call next healthy, server 1", async () => {
    serverErrors.set(0, true);
    await requestTestRoute();
    assertServerCallCount(0, [1, 1, 0]);
  });

  it("server 1 also throws, so call next healthy server 2", async () => {
    serverErrors.set(0, true);
    serverErrors.set(1, true);
    await requestTestRoute();
    assertServerCallCount(0, [1, 1, 1]);
  });

  it("servers 0,1 recently errored, so call 0,1,2 until healthy", async () => {
    // servers 0,1 errors
    serverErrors.set(0, true);
    serverErrors.set(1, true);
    await requestTestRoute();
    assertServerCallCount(0, [1, 1, 1]);

    // servers 0,1 recently errored, so call 0,1,2 until healthy
    serverErrors.set(0, false);
    serverErrors.set(1, false);
    await requestTestRoute();
    assertServerCallCount(1, [1, 1, 1]);
    await requestTestRoute();
    assertServerCallCount(2, [1, 1, 1]);
    await requestTestRoute();
    assertServerCallCount(3, [1, 0, 0]);
  });

  it("all URLs fail, expect error from the last server", async () => {
    serverErrors.set(0, true);
    serverErrors.set(1, true);
    serverErrors.set(2, true);
    await expect(requestTestRoute()).rejects.toThrow("test_error_server_2");
    assertServerCallCount(0, [1, 1, 1]);
  });
});
