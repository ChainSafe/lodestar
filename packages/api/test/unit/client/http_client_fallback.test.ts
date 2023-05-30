import Sinon from "sinon";
import {expect} from "chai";
import {HttpClient} from "../../../src/utils/client/index.js";

describe("httpClient fallback", () => {
  const testRoute = {url: "/test-route", method: "GET" as const};
  const DEBUG_LOGS = Boolean(process.env.DEBUG);

  // Using fetchSub instead of actually setting up servers because there are some strange
  // race conditions, where the server stub doesn't count the call in time before the test is over.
  const fetchStub = Sinon.stub<[string], ReturnType<typeof fetch>>();

  let httpClient: HttpClient;

  const serverCount = 3;
  const baseUrls: string[] = [];
  for (let i = 0; i < serverCount; i++) {
    baseUrls.push(`http://127.0.0.1:${18000 + i}`);
  }

  const serverErrors = new Map<number, boolean>();

  // With baseURLs above find the server index associated with that URL
  function getServerIndex(url: string): number {
    const i = baseUrls.findIndex((baseUrl) => url.startsWith(baseUrl));
    if (i < 0) {
      throw Error(`fetch called with unknown url ${url}`);
    }
    return i;
  }

  // Create fresh HttpClient with new internal state
  beforeEach(() => {
    httpClient = new HttpClient({
      baseUrl: "",
      urls: baseUrls.map((baseUrl) => ({baseUrl})),
      fetch: fetchStub as typeof fetch,
    });

    fetchStub.callsFake(async (url) => {
      // Simulate network delay
      await new Promise((r) => setTimeout(r, 10));
      const i = getServerIndex(url);
      if (serverErrors.get(i)) {
        throw Error(`test_error_server_${i}`);
      } else {
        return {ok: true} as Response;
      }
    });
  });

  afterEach(() => {
    fetchStub.reset();
    serverErrors.clear();
  });

  // Compares the call count of all server on a request, prints the diff as "1,1,0" == "1,0,0"
  function assertServerCallCount(step: number, expectedCallCounts: number[]): void {
    const callCounts: number[] = [];
    for (let i = 0; i < serverCount; i++) callCounts[i] = 0;
    for (const call of fetchStub.getCalls()) {
      callCounts[getServerIndex(call.args[0])]++;
    }

    expect(callCounts.join(",")).equals(expectedCallCounts.join(","), `step ${step} - callCounts`);

    fetchStub.resetHistory();

    // eslint-disable-next-line no-console
    if (DEBUG_LOGS) console.log("completed assertions step", step);
  }

  async function requestTestRoute(): Promise<void> {
    await httpClient.request(testRoute);
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
    await expect(requestTestRoute()).rejectedWith("test_error_server_2");
    assertServerCallCount(0, [1, 1, 1]);
  });
});
